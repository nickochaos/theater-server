// routes/fake_payment.js
const express = require('express');
const router = express.Router();
const db = require('../db'); // Нам понадобится для обновления статуса заказа

// GET /api/fake-payment/pay?orderId=X&amount=Y
// Это страница, куда "перенаправляется" пользователь для "оплаты"
router.get('/pay', async (req, res) => {
    const { orderId, amount } = req.query;
    if (!orderId || !amount) {
        return res.status(400).send('<h1>Ошибка: Не указан ID заказа или сумма.</h1>');
    }

    // Простая HTML-страница для имитации ввода данных карты
    // В реальном приложении это была бы страница платежного шлюза
    res.send(`
        <html>
            <head><title>Фейковая Оплата</title></head>
            <body>
                <h1>Оплата Заказа #${orderId}</h1>
                <p>Сумма к оплате: ${amount} руб.</p>
                <form action="/api/fake-payment/process" method="POST">
                    <input type="hidden" name="orderId" value="${orderId}" />
                    <input type="hidden" name="amount" value="${amount}" />
                    <label for="cardNumber">Номер карты:</label><br>
                    <input type="text" id="cardNumber" name="cardNumber" value="4242 4242 4242 4242" required><br><br>
                    <label for="expiryDate">Срок действия (ММ/ГГ):</label><br>
                    <input type="text" id="expiryDate" name="expiryDate" value="12/25" required><br><br>
                    <label for="cvc">CVC:</label><br>
                    <input type="text" id="cvc" name="cvc" value="123" required><br><br>
                    <button type="submit">Оплатить (Симуляция)</button>
                </form>
                <hr>
                <form action="/api/fake-payment/process" method="POST">
                     <input type="hidden" name="orderId" value="${orderId}" />
                    <input type="hidden" name="amount" value="${amount}" />
                    <input type="hidden" name="simulate_failure" value="true" />
                    <button type="submit" style="background-color: #ffcccc;">Симулировать Ошибку Оплаты</button>
                </form>
            </body>
        </html>
    `);
});

// POST /api/fake-payment/process - "Обработка" фейкового платежа
// Этот эндпоинт имитирует то, что происходит ПОСЛЕ того, как пользователь ввел данные на стороне платежки.
router.post('/process', async (req, res) => {
    const { orderId, amount, simulate_failure } = req.body; // Получаем данные из формы
    const userId = req.user ? req.user.id : null; // Если у вас есть сессия/аутентификация здесь

    if (!orderId || !amount) {
        return res.status(400).send('Ошибка: Отсутствует ID заказа или сумма при обработке.');
    }

    console.log(`Фейковая обработка платежа для заказа ${orderId}, сумма ${amount}`);
    // Мы не делаем ничего с "данными карты", так как это фейк

    const paymentSuccessful = simulate_failure !== 'true'; // Успех, если не симулируем ошибку

    const frontendUrl = process.env.FRONTEND_URL;
    if (!frontendUrl) {
        console.error("FRONTEND_URL не установлен в переменных окружения!");
        // Fallback или ошибка, если URL фронтенда не настроен
        return res.status(500).send("Ошибка конфигурации сервера: Не указан URL фронтенда для редиректа.");
    }

    // --- Имитация вызова Webhook-а ---
    // В реальном приложении этот вызов делает сама платежная система на ваш /api/payment/webhook/...
    // Здесь мы его имитируем для обновления статуса заказа и создания записей в sales.
    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        const orderRes = await client.query(
            "SELECT id, status, user_id FROM orders WHERE id = $1 FOR UPDATE",
             [orderId]
        );
        if (orderRes.rows.length === 0) {
             console.warn(`Webhook (Фейк): Заказ ${orderId} не найден.`);
             await client.query('ROLLBACK');
             // Отправляем пользователя на страницу результата
             return res.redirect(`/payment-result.html?status=error&message=OrderNotFound&orderId=${orderId}`);
        }
        const currentOrder = orderRes.rows[0];

        if (currentOrder.status === 'paid' || currentOrder.status === 'cancelled' || currentOrder.status === 'payment_failed') {
            console.log(`Webhook (Фейк): Заказ ${orderId} уже обработан (статус: ${currentOrder.status}).`);
            await client.query('ROLLBACK');
            // Отправляем пользователя на страницу результата в зависимости от текущего статуса
            const resultStatus = currentOrder.status === 'paid' ? 'success' : 'failed';
            return res.redirect(`/payment-result.html?status=${resultStatus}&message=AlreadyProcessed&orderId=${orderId}`);
        }


        if (paymentSuccessful) {
            console.log(`Webhook (Фейк): Успешная оплата для заказа ${orderId}`);
            await client.query("UPDATE orders SET status = 'paid' WHERE id = $1", [orderId]);

            const ticketsRes = await client.query(
                 "SELECT t.id, t.final_price FROM tickets t JOIN bookings b ON b.ticket_id = t.id WHERE b.order_id = $1",
                 [orderId]
             );
            for (const ticket of ticketsRes.rows) {
                 await client.query(
                    "INSERT INTO sales (order_id, ticket_id, total_price, payment_method) VALUES ($1, $2, $3, $4)",
                    [orderId, ticket.id, ticket.final_price, 'fake_payment_gateway']
                 );
             }
            await client.query('COMMIT');
            console.log(`Заказ ${orderId} помечен как оплаченный (фейк).`);
            // Перенаправляем пользователя на страницу успеха
            res.redirect(`${frontendUrl}/payment/result?status=success&orderId=${orderId}`);
        } else {
            console.log(`Webhook (Фейк): Ошибка оплаты для заказа ${orderId}`);
            await client.query("UPDATE orders SET status = 'payment_failed' WHERE id = $1", [orderId]);
            // В реальной системе билеты/брони освобождались бы
            const bookingsRes = await client.query("SELECT id, ticket_id FROM bookings WHERE order_id = $1", [orderId]);
             if (bookingsRes.rows.length > 0) {
                 const ticketIds = bookingsRes.rows.map(b => b.ticket_id);
                 await client.query("DELETE FROM bookings WHERE order_id = $1", [orderId]);
                 await client.query("DELETE FROM tickets WHERE id = ANY($1::int[])", [ticketIds]);
             }
            await client.query('COMMIT');
            console.log(`Заказ ${orderId} помечен как 'ошибка оплаты' (фейк).`);
            // Перенаправляем пользователя на страницу ошибки
            res.redirect(`${frontendUrl}/payment/result?status=failed&orderId=${orderId}`);
        }
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Webhook (Фейк) Error: Ошибка обработки уведомления для заказа ${orderId}:`, error);
        res.redirect(`${frontendUrl}/payment/result?status=error&message=ServerError&orderId=${orderId}`);
    } finally {
        client.release();
    }
});

module.exports = router;
