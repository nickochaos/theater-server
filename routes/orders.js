// routes/orders.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { protect, isAdmin } = require('../middleware/authMiddleware');

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
// (В реальном проекте их лучше вынести в отдельный service/helper файл)

// Функция для расчета цены билета
async function calculateTicketPrice(seatId, client = db) { // Принимаем клиента БД
    const query = `
        SELECT
            s.base_price,
            COALESCE(z.price_multiplier, 1.0) as zone_multiplier,
            COALESCE(r.price_multiplier, 1.0) as row_multiplier
        FROM seats s
        LEFT JOIN zones z ON s.zone_id = z.id
        LEFT JOIN rows r ON s.row_id = r.id
        WHERE s.id = $1
    `;
    // Используем переданного клиента (для транзакций) или пул по умолчанию
    const { rows } = await client.query(query, [seatId]);
    if (rows.length === 0) {
        throw new Error(`Место с ID ${seatId} не найдено для расчета цены.`);
    }
    const data = rows[0];
    // Убедимся, что работаем с числами
    const basePrice = parseFloat(data.base_price);
    const zoneMultiplier = parseFloat(data.zone_multiplier);
    const rowMultiplier = parseFloat(data.row_multiplier);

    if (isNaN(basePrice) || isNaN(zoneMultiplier) || isNaN(rowMultiplier)) {
         throw new Error(`Ошибка в данных цены/множителя для места ID ${seatId}.`);
    }

    const finalPrice = basePrice * zoneMultiplier * rowMultiplier;
    // Округление до 2 знаков после запятой
    return Math.round(finalPrice * 100) / 100;
}

// Функция для проверки доступности мест внутри транзакции
async function checkSeatsAvailability(scheduleId, seatIds, client) { // Требуем клиента БД
    if (!seatIds || seatIds.length === 0) {
        return { available: true, unavailableSeats: [] };
    }
    // Ищем существующие бронирования ИЛИ ручные блокировки для этих мест на этот сеанс
    // Добавляем FOR UPDATE, чтобы заблокировать строки на время транзакции, предотвращая гонку запросов
    const query = `
    SELECT seat_id
    FROM (
        SELECT DISTINCT t.seat_id
        FROM tickets t
        JOIN bookings b ON b.ticket_id = t.id
        WHERE b.schedule_id = $1 AND t.seat_id = ANY($2::int[])

        UNION -- <--- Оператор UNION

        SELECT DISTINCT sr.seat_id
        FROM seat_reservations sr
        WHERE sr.schedule_id = $1 AND sr.seat_id = ANY($2::int[])
    ) AS unavailable_seats -- <--- Оборачиваем в подзапрос и даем ему имя
    FOR UPDATE; -- <--- Применяем FOR UPDATE ко всему результату
`;
    const { rows } = await client.query(query, [scheduleId, seatIds]);
    const unavailableSeats = rows.map(row => row.seat_id);
    // Находим пересечение запрошенных и недоступных мест
    const actuallyUnavailableInRequest = seatIds.filter(id => unavailableSeats.includes(parseInt(id, 10)));

    return {
        available: actuallyUnavailableInRequest.length === 0,
        unavailableSeats: actuallyUnavailableInRequest // Возвращаем ID недоступных мест из запроса
    };
}

// --- МАРШРУТЫ ---

// POST /api/orders/initiate - Инициировать создание заказа перед оплатой
router.post('/initiate', protect, async (req, res) => {
    const userId = req.user.id;
    const { schedule_id, seats } = req.body; // seats - массив ID мест [1, 2, 3]

    // Валидация входных данных
    if (!schedule_id || !/^\d+$/.test(String(schedule_id))) {
         return res.status(400).json({ error: 'Требуется корректный числовой schedule_id' });
    }
    if (!Array.isArray(seats) || seats.length === 0) {
        return res.status(400).json({ error: 'Требуется непустой массив ID мест (seats)' });
    }

    const seatIds = seats.map(id => parseInt(id, 10));
    if (seatIds.some(isNaN)) { // Проверяем, что все элементы стали числами
         return res.status(400).json({ error: 'Массив seats содержит нечисловые ID' });
    }

    // Получаем клиента из пула для выполнения всей операции в транзакции
    const client = await db.getClient();

    try {
        await client.query('BEGIN'); // Начинаем транзакцию

        // 1. Проверить существование сеанса и получить hall_id
        const scheduleCheck = await client.query('SELECT hall_id FROM schedule WHERE id = $1', [schedule_id]);
        if (scheduleCheck.rows.length === 0) {
            throw new Error(`Сеанс с ID ${schedule_id} не найден.`);
        }
        // const hallId = scheduleCheck.rows[0].hall_id; // Может понадобиться для доп. проверок

        // 2. Проверить, что все запрошенные места принадлежат залу этого сеанса (доп. проверка)
        const seatsHallCheck = await client.query(
            'SELECT id FROM seats WHERE id = ANY($1::int[]) AND hall_id = $2',
            [seatIds, scheduleCheck.rows[0].hall_id]
        );
        if (seatsHallCheck.rows.length !== seatIds.length) {
            throw new Error('Одно или несколько выбранных мест не принадлежат залу данного сеанса.');
        }

        // 3. Проверить доступность мест (критически важно, используем FOR UPDATE)
        const availability = await checkSeatsAvailability(schedule_id, seatIds, client);
        if (!availability.available) {
            throw new Error(`Места с ID: ${availability.unavailableSeats.join(', ')} уже заняты или заблокированы.`);
        }

        // 4. Создать заказ
        const orderResult = await client.query(
            "INSERT INTO orders (user_id, status) VALUES ($1, 'awaiting_payment') RETURNING id, status, order_date",
            [userId]
        );
        const newOrder = orderResult.rows[0];
        const orderId = newOrder.id;

        // 5. Создать билеты и бронирования для каждого места
        let totalAmount = 0;
        const createdTicketsInfo = []; // Будем хранить ID и цену

        for (const seatId of seatIds) {
            // Рассчитать цену
            const finalPrice = await calculateTicketPrice(seatId, client);
            totalAmount += finalPrice;

            // Создать билет
            const ticketResult = await client.query(
                "INSERT INTO tickets (seat_id, final_price) VALUES ($1, $2) RETURNING id",
                [seatId, finalPrice]
            );
            const ticketId = ticketResult.rows[0].id;
            createdTicketsInfo.push({ ticketId: ticketId, price: finalPrice, seatId: seatId });

            // Создать бронирование
            await client.query(
                "INSERT INTO bookings (schedule_id, order_id, ticket_id) VALUES ($1, $2, $3)",
                [schedule_id, orderId, ticketId]
            );
        }

        // 6. (Опционально) Можно создать временные блокировки в seat_reservations,
        // но блокировка строк через FOR UPDATE в checkSeatsAvailability уже частично решает проблему гонки.
        // Если процесс оплаты может быть долгим, временные блокировки с таймером могут быть полезны.

        await client.query('COMMIT'); // Фиксируем транзакцию

        // --- ВЗАИМОДЕЙСТВИЕ С ПЛАТЕЖНОЙ СИСТЕМОЙ (ЗАГЛУШКА) ---
        // Здесь должна быть логика создания платежа в вашей платежной системе.
        // Возвращаемые данные зависят от шлюза.
        console.log(`Order ${orderId} created for user ${userId}, amount: ${totalAmount}. Awaiting payment.`);
        const paymentInfo = { // Заглушка
            paymentUrl: `http://your-payment-gateway.com/pay?order=${orderId}&amount=${totalAmount}`,
            paymentGatewayId: `temp_id_${orderId}_${Date.now()}`
        };
        // ----------------------------------------------------------

        res.status(201).json({
            message: 'Заказ успешно создан, ожидается оплата.',
            order: {
                id: orderId,
                status: newOrder.status,
                orderDate: newOrder.order_date,
                totalAmount: totalAmount,
                userId: userId,
            },
            tickets: createdTicketsInfo, // Информация о созданных билетах
            paymentInfo: paymentInfo // Информация для редиректа на оплату
        });

    } catch (err) {
        // Обязательно откатываем транзакцию при любой ошибке
        await client.query('ROLLBACK');
        console.error('Ошибка при инициации заказа:', err);
        // Возвращаем 400 или 409 для ожидаемых ошибок (места заняты), 500 для остальных
        if (err.message.includes('уже заняты или заблокированы')) {
             res.status(409).json({ error: `Не удалось создать заказ: ${err.message}` }); // 409 Conflict
        } else if (err.message.includes('не найден') || err.message.includes('не принадлежат залу')) {
            res.status(404).json({ error: `Не удалось создать заказ: ${err.message}` }); // 404 Not Found (для сеанса/мест)
        }
        else {
            res.status(500).json({ error: 'Внутренняя ошибка сервера при создании заказа.' });
        }
    } finally {
        // Всегда освобождаем клиента обратно в пул
        client.release();
    }
});


// GET /api/orders - Получить заказы (защищено, фильтрация для админа/пользователя)
router.get('/', protect, async (req, res) => {
  const userId = req.user.id;
  const userRole = req.user.role;
  const { user_id_filter, status, limit = 20, page = 1 } = req.query; // user_id_filter для админа
  const offset = (page - 1) * limit;

  const params = [];
  const conditions = [];
  let targetUserId = userId; // По умолчанию пользователь смотрит свои заказы

  // Админ может фильтровать по ID пользователя
  if (userRole === 'admin' && user_id_filter && /^\d+$/.test(user_id_filter)) {
      targetUserId = parseInt(user_id_filter, 10);
      conditions.push(`o.user_id = $${params.length + 1}`);
      params.push(targetUserId);
  } else if (userRole !== 'admin') {
       // Обычный пользователь может видеть только свои заказы
       conditions.push(`o.user_id = $${params.length + 1}`);
       params.push(userId);
  }
   // Если админ не указал user_id_filter, он видит все заказы

  if (status) {
    conditions.push(`o.status = $${params.length + 1}`);
    params.push(status);
  }

  // Собираем условия WHERE
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
      // Запрос для получения общего количества
      const totalResult = await db.query(`SELECT COUNT(*) FROM orders o ${whereClause}`, params);
      const totalItems = parseInt(totalResult.rows[0].count, 10);

      // Запрос для получения данных с пагинацией
      // Добавляем параметры пагинации в конец
      params.push(limit);
      params.push(offset);
      const sql = `
        SELECT o.id, o.order_date as "orderDate", o.status, o.user_id as "userId", u.username
        FROM orders o
        LEFT JOIN users u ON o.user_id = u.id
        ${whereClause}
        ORDER BY o.order_date DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`; // Ссылаемся на limit и offset

      const { rows } = await db.query(sql, params);

       res.json({
            totalPages: Math.ceil(totalItems / limit),
            currentPage: page,
            totalItems: totalItems,
            items: rows
        });

  } catch (err) {
    console.error('Ошибка при получении заказов:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/orders/:id - Получить заказ по ID (защищено, + проверка владения)
router.get('/:id', protect, async (req, res) => {
     const orderId = parseInt(req.params.id, 10);
     const userId = req.user.id;
     const userRole = req.user.role;

     if (isNaN(orderId)) {
          return res.status(400).json({ error: 'Неверный ID заказа' });
     }

     try {
        // Получаем сам заказ
        const orderRes = await db.query(`
            SELECT o.id, o.order_date as "orderDate", o.status, o.user_id as "userId", u.username
            FROM orders o
            LEFT JOIN users u ON o.user_id = u.id
            WHERE o.id = $1
        `, [orderId]);

        if (orderRes.rows.length === 0) {
          return res.status(404).json({ error: 'Заказ не найден' });
        }
        const orderData = orderRes.rows[0];

        // Проверка прав: админ или владелец заказа
        if (userRole !== 'admin' && orderData.userId !== userId) {
             return res.status(403).json({ error: 'Доступ запрещен к этому заказу' });
        }

        // Получаем связанные бронирования/билеты
        const bookingsRes = await db.query(`
            SELECT
                b.id as booking_id, b.ticket_id, t.final_price,
                s.seat_number, r.row_name, z.zone_name, h.hall_name,
                sch.start_date, sch.start_time, p.title as performance_title
            FROM bookings b
            JOIN tickets t ON b.ticket_id = t.id
            JOIN seats s ON t.seat_id = s.id
            JOIN rows r ON s.row_id = r.id
            JOIN zones z ON s.zone_id = z.id
            JOIN halls h ON s.hall_id = h.id
            JOIN schedule sch ON b.schedule_id = sch.id
            JOIN performances p ON sch.performance_id = p.id
            WHERE b.order_id = $1
            ORDER BY t.id -- Или другая осмысленная сортировка
        `, [orderId]);

        orderData.bookings = bookingsRes.rows; // Добавляем детали бронирования

        res.json(orderData);

     } catch (err) {
         console.error(`Ошибка при получении заказа ${orderId}:`, err);
         res.status(500).json({ error: 'Внутренняя ошибка сервера' });
     }
});

// GET /api/orders/:id/status - Получить статус заказа (защищено, + проверка владения)
router.get('/:id/status', protect, async (req, res) => {
    const orderId = parseInt(req.params.id, 10);
    const userId = req.user.id;
    const userRole = req.user.role;

    if (isNaN(orderId)) {
        return res.status(400).json({ error: 'Неверный ID заказа' });
    }

     try {
        const { rows } = await db.query('SELECT id, status, user_id FROM orders WHERE id = $1', [orderId]);
         if (rows.length === 0) {
            return res.status(404).json({ error: 'Заказ не найден' });
        }
        // Проверка прав: админ или владелец заказа
        if (userRole !== 'admin' && rows[0].user_id !== userId) {
             return res.status(403).json({ error: 'Доступ запрещен к статусу этого заказа' });
        }
        res.json({ orderId: rows[0].id, status: rows[0].status });
     } catch (err) {
          console.error(`Ошибка получения статуса заказа ${orderId}:`, err);
          res.status(500).json({ error: 'Внутренняя ошибка сервера' });
     }
});


// PUT /api/orders/:id - Обновить статус заказа (Только Админ)
router.put('/:id', protect, isAdmin, async (req, res) => {
  const orderId = parseInt(req.params.id, 10);
  const { status } = req.body; // Обновляем только статус

  if (isNaN(orderId)) {
        return res.status(400).json({ error: 'Неверный ID заказа' });
  }
  if (!status) {
     return res.status(400).json({ error: 'Требуется новый статус заказа (status)' });
  }
  // TODO: Добавить валидацию допустимых значений статуса
  const allowedStatuses = ['pending', 'awaiting_payment', 'paid', 'cancelled', 'payment_failed'];
  if (!allowedStatuses.includes(status)) {
       return res.status(400).json({ error: `Недопустимый статус заказа: ${status}` });
  }

  // !!! ВАЖНО: Если админ меняет статус на 'cancelled' или 'payment_failed',
  // нужно также освободить билеты/бронирования, как это делается в вебхуке!
  // Это требует транзакции.

  const client = await db.getClient();
  try {
       await client.query('BEGIN');

       const { rows, rowCount } = await client.query(
           'UPDATE orders SET status = $1 WHERE id = $2 RETURNING *',
           [status, orderId]
       );

       if (rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Заказ не найден для обновления' });
       }

       // Если статус 'cancelled' или 'payment_failed', освобождаем места
       if (status === 'cancelled' || status === 'payment_failed') {
            console.log(`Заказ ${orderId} отменен админом. Освобождение мест...`);
            const bookingsRes = await client.query("SELECT id, ticket_id FROM bookings WHERE order_id = $1", [orderId]);
             if (bookingsRes.rows.length > 0) {
                 const ticketIds = bookingsRes.rows.map(b => b.ticket_id);
                 await client.query("DELETE FROM bookings WHERE order_id = $1", [orderId]);
                 await client.query("DELETE FROM tickets WHERE id = ANY($1::int[])", [ticketIds]);
                 console.log(`Удалены бронирования и билеты для заказа ${orderId}.`);
             }
       }

       await client.query('COMMIT');
       res.json(rows[0]); // Возвращаем обновленный заказ

  } catch (err) {
        await client.query('ROLLBACK');
        console.error(`Ошибка при обновлении заказа ${orderId} админом:`, err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  } finally {
       client.release();
  }
});

// DELETE /api/orders/:id - Удалить заказ (Только Админ, ОСТОРОЖНО!)
// Обычно лучше отменять (менять статус), а не удалять.
router.delete('/:id', protect, isAdmin, async (req, res) => {
  const orderId = parseInt(req.params.id, 10);

  if (isNaN(orderId)) {
        return res.status(400).json({ error: 'Неверный ID заказа' });
  }

  // ВАЖНО: Перед удалением заказа нужно удалить связанные данные
  // из bookings, tickets, sales (если есть ON DELETE RESTRICT).
  // Лучше делать это в транзакции.

  const client = await db.getClient();
  try {
      await client.query('BEGIN');

       // Сначала удаляем связанные записи (если нет CASCADE)
       const bookingsRes = await client.query("SELECT ticket_id FROM bookings WHERE order_id = $1", [orderId]);
       const ticketIds = bookingsRes.rows.map(b => b.ticket_id);

       await client.query("DELETE FROM sales WHERE order_id = $1", [orderId]);
       await client.query("DELETE FROM bookings WHERE order_id = $1", [orderId]);
       if (ticketIds.length > 0) {
           await client.query("DELETE FROM tickets WHERE id = ANY($1::int[])", [ticketIds]);
       }

       // Затем удаляем сам заказ
      const { rowCount } = await client.query('DELETE FROM orders WHERE id = $1', [orderId]);

      if (rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Заказ не найден для удаления' });
      }

      await client.query('COMMIT');
      console.log(`Заказ ${orderId} и связанные данные удалены админом.`);
      res.status(204).send(); // No Content

  } catch (err) {
        await client.query('ROLLBACK');
        console.error(`Ошибка при удалении заказа ${orderId} админом:`, err);
        // Проверка на foreign key может быть уже не нужна, т.к. мы удалили зависимости вручную
        // if (err.code === '23503') {
        //    return res.status(409).json({ error: 'Невозможно удалить заказ, так как с ним связаны другие данные.' });
        // }
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  } finally {
      client.release();
  }
});


module.exports = router;
