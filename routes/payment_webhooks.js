// routes/payment_webhooks.js
const express = require('express');
const router = express.Router();
const db = require('../db');
// const crypto = require('crypto'); // Для верификации подписи

// --- Middleware для верификации вебхука (ЗАГЛУШКА!) ---
// ВАМ НУЖНО РЕАЛИЗОВАТЬ РЕАЛЬНУЮ ВЕРИФИКАЦИЮ ДЛЯ ВАШЕЙ ПЛАТЕЖНОЙ СИСТЕМЫ!
// Это может включать проверку IP-адреса источника, проверку HMAC-подписи и т.д.
const verifyPaymentWebhook = (req, res, next) => {
    const gatewaySignature = req.headers['x-payment-signature']; // Пример заголовка
    const secretKey = process.env.PAYMENT_GATEWAY_WEBHOOK_SECRET; // Ваш секретный ключ для вебхука

     if (!gatewaySignature || !secretKey) {
         console.warn('Webhook verification skipped: No signature or secret key.');
         // В продакшене здесь должна быть ошибка 403 Forbidden
         // return res.status(403).send('Forbidden: Invalid signature');
         return next(); // Пока пропускаем для теста
     }

    // --- Пример верификации HMAC SHA256 (адаптируйте под вашу систему!) ---
    // const hmac = crypto.createHmac('sha256', secretKey);
    // const digest = Buffer.from(hmac.update(JSON.stringify(req.body)).digest('hex'), 'utf8'); // Используйте rawBody, если нужно
    // const checksum = Buffer.from(gatewaySignature, 'utf8');
    // if (checksum.length !== digest.length || !crypto.timingSafeEqual(digest, checksum)) {
    //      console.error('Webhook verification failed: Invalid signature');
    //      return res.status(403).send('Forbidden: Invalid signature');
    // }
    // ---------------------------------------------------------------------

    console.log('Webhook signature verified (ЗАГЛУШКА!)');
    next(); // Подпись верна (или проверка пропущена)
};
// ---------------------------------------------------------


// POST /api/payment/webhook/:gatewayName - Обработчик вебхука
// :gatewayName позволяет иметь разные обработчики для разных систем
router.post('/:gatewayName', verifyPaymentWebhook, async (req, res) => {
    const gatewayName = req.params.gatewayName;
    const notification = req.body; // Тело уведомления от платежной системы

    console.log(`Получен Webhook от [${gatewayName}]:`, JSON.stringify(notification, null, 2));

    // --- ЛОГИКА ОБРАБОТКИ УВЕДОМЛЕНИЯ (СИЛЬНО ЗАВИСИТ ОТ ПЛАТЕЖНОЙ СИСТЕМЫ!) ---
    // Вам нужно извлечь ID вашего заказа и статус платежа из объекта `notification`

    // ПРИМЕР (адаптируйте под вашу систему):
    const orderId = notification.object?.metadata?.order_id; // Пример: ID заказа в метаданных
    const paymentStatus = notification.object?.status; // Пример: статус платежа ('succeeded', 'failed', etc.)
    const transactionId = notification.object?.id; // Пример: ID транзакции в платежной системе

    if (!orderId || !paymentStatus) {
        console.error('Webhook Error: Не удалось извлечь orderId или paymentStatus из уведомления.');
        return res.status(400).send('Bad Request: Invalid notification format.');
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        // 1. Найти заказ и проверить его текущий статус
        const orderRes = await client.query(
            "SELECT id, status FROM orders WHERE id = $1 FOR UPDATE", // Блокируем строку заказа
             [orderId]
        );
        if (orderRes.rows.length === 0) {
             console.warn(`Webhook Warning: Заказ ${orderId} не найден.`);
             // Все равно отвечаем 200, чтобы платежка не слала повторно
             await client.query('ROLLBACK');
             return res.status(200).send('OK: Order not found, acknowledged.');
        }
        const currentStatus = orderRes.rows[0].status;

        // 2. Идемпотентность: Если заказ уже оплачен или отменен, ничего не делаем
        if (currentStatus === 'paid' || currentStatus === 'cancelled' || currentStatus === 'payment_failed') {
            console.log(`Webhook Info: Заказ ${orderId} уже обработан (статус: ${currentStatus}). Игнорируем уведомление.`);
            await client.query('ROLLBACK');
            return res.status(200).send('OK: Already processed.');
        }

        // 3. Обработка в зависимости от статуса платежа
        if (paymentStatus === 'succeeded' || paymentStatus === 'paid') { // Успешная оплата
            console.log(`Обработка успешной оплаты для заказа ${orderId}...`);
            // Обновить статус заказа
            await client.query("UPDATE orders SET status = 'paid' WHERE id = $1", [orderId]);

             // Найти связанные билеты для записи в sales
             const ticketsRes = await client.query(
                 "SELECT t.id, t.final_price FROM tickets t JOIN bookings b ON b.ticket_id = t.id WHERE b.order_id = $1",
                 [orderId]
             );

            // Создать записи в sales
             for (const ticket of ticketsRes.rows) {
                 await client.query(
                    "INSERT INTO sales (order_id, ticket_id, total_price, payment_method) VALUES ($1, $2, $3, $4)",
                    [orderId, ticket.id, ticket.final_price, gatewayName] // Используем имя шлюза как метод
                 );
             }
             // TODO: Отправить email пользователю
             console.log(`Заказ ${orderId} успешно оплачен.`);

        } else if (paymentStatus === 'failed' || paymentStatus === 'canceled') { // Неуспешная оплата
             console.log(`Обработка НЕуспешной оплаты для заказа ${orderId}...`);
             // Отменить заказ, освободить билеты/бронирования
             await client.query("UPDATE orders SET status = 'payment_failed' WHERE id = $1", [orderId]);
             // Найти связанные бронирования и билеты
             const bookingsRes = await client.query("SELECT id, ticket_id FROM bookings WHERE order_id = $1", [orderId]);
             if (bookingsRes.rows.length > 0) {
                 const ticketIds = bookingsRes.rows.map(b => b.ticket_id);
                 // Удалить бронирования
                 await client.query("DELETE FROM bookings WHERE order_id = $1", [orderId]);
                 // Удалить билеты
                 await client.query("DELETE FROM tickets WHERE id = ANY($1::int[])", [ticketIds]);
             }
             // TODO: Удалить временные seat_reservations, если они были
              console.log(`Заказ ${orderId} отменен из-за ошибки оплаты.`);
        } else {
            console.log(`Webhook Info: Неизвестный статус платежа '${paymentStatus}' для заказа ${orderId}. Игнорируем.`);
        }

        await client.query('COMMIT');
        res.status(200).send('OK: Processed.'); // Отправляем ОК платежной системе

    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Webhook Error: Ошибка обработки уведомления для заказа ${orderId}:`, error);
        // Важно НЕ отправлять 500 платежной системе, иначе она будет повторять вебхук.
        // Лучше залогировать и разобраться. Можно отправить 200 или специальный код ошибки,
        // если платежка поддерживает повторы только для определенных кодов.
        // Отправка 500 может привести к бесконечным повторам.
        res.status(200).send('OK: Error processing, logged.'); // Сообщаем ОК, но логируем ошибку
    } finally {
        client.release();
    }
});

module.exports = router;
