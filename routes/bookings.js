// routes/bookings.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/bookings - Получить бронирования с фильтрацией
// Добавлено JOIN с tickets для получения seat_id
// Нужна фильтрация по order_id, schedule_id или ticket_id
router.get('/', async (req, res) => {
  const { order_id, schedule_id, ticket_id } = req.query;
  let sql = `
    SELECT b.id, b.schedule_id, b.order_id, b.ticket_id, t.seat_id -- <-- ДОБАВЛЕНО t.seat_id
    FROM bookings b
    JOIN tickets t ON b.ticket_id = t.id -- <-- ДОБАВЛЕНО JOIN с таблицей tickets
  `; // Изменен SQL запрос
  const params = [];
  const conditions = [];

   if (order_id) {
    // Проверяем, что order_id является числом для безопасности (если это числовой ID)
    if (!/^\d+$/.test(order_id)) {
         return res.status(400).json({ error: 'Неверный формат order_id' });
     }
    params.push(order_id);
    conditions.push(`b.order_id = $${params.length}`); // Указываем таблицу для поля
  }
  if (schedule_id) {
    // Проверяем, что schedule_id является числом для безопасности
    if (!/^\d+$/.test(schedule_id)) {
         return res.status(400).json({ error: 'Неверный формат schedule_id' });
     }
    params.push(schedule_id);
    conditions.push(`b.schedule_id = $${params.length}`); // Указываем таблицу для поля
  }
   if (ticket_id) {
    // Проверяем, что ticket_id является числом для безопасности
    if (!/^\d+$/.test(ticket_id)) {
         return res.status(400).json({ error: 'Неверный формат ticket_id' });
     }
    params.push(ticket_id);
    conditions.push(`b.ticket_id = $${params.length}`); // Указываем таблицу для поля
  }
   // TODO: Если нужна фильтрация по user_id, ее нужно добавить здесь и, возможно, JOIN с таблицей orders


  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  // Добавляем сортировку для предсказуемого порядка (опционально)
  sql += ' ORDER BY b.id'; // Или по другому полю

  try {
    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка при получении бронирований:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/bookings/:id - Получить бронирование по ID
router.get('/:id', async (req, res) => {
   const { id } = req.params;
    // TODO: Возможно, здесь тоже нужно добавить JOIN на tickets, orders, schedule, performance, hall, seats для полной информации
   try {
     const { rows } = await db.query('SELECT * FROM bookings WHERE id = $1', [id]);
     if (rows.length === 0) {
       return res.status(404).json({ error: 'Бронирование не найдено' });
     }
     res.json(rows[0]);
   } catch (err) {
     console.error(`Ошибка при получении бронирования ${id}:`, err);
     res.status(500).json({ error: 'Внутренняя ошибка сервера' });
   }
});


// POST /api/bookings - Создать новое бронирование (Вероятно, используется в процессе покупки/резервации, не напрямую из админки)
// Этот маршрут может не требовать isAdmin, если он используется пользовательским приложением
// Но если это только админская функция, добавьте protect, isAdmin
router.post('/', async (req, res) => {
    const { schedule_id, order_id, ticket_id } = req.body;
    // TODO: Добавить проверки данных

   if (!schedule_id || !order_id || !ticket_id) {
     return res.status(400).json({ error: 'Требуются schedule_id, order_id, ticket_id' });
   }
   try {
     const sql = 'INSERT INTO bookings (schedule_id, order_id, ticket_id) VALUES ($1, $2, $3) RETURNING *';
     const { rows } = await db.query(sql, [schedule_id, order_id, ticket_id]);
     res.status(201).json(rows[0]);
   } catch (err) {
     console.error('Ошибка при создании бронирования:', err);
     if (err.code === '23503') { // FK violation
       return res.status(400).json({ error: 'Указанное событие, заказ или билет не существуют.' });
     }
      if (err.code === '23505') { // unique constraint violation (ticket_id or schedule_id, ticket_id)
       return res.status(409).json({ error: 'Этот билет уже забронирован (возможно, на это событие).' });
     }
     res.status(500).json({ error: 'Внутренняя ошибка сервера' });
   }
});

// DELETE /api/bookings/:id (ОСТОРОЖНО!)
// Удаление бронирования должно быть частью логики отмены заказа, а не просто удалением записи
// Обычно требует protect, isAdmin, если доступно только админам
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
   try {
     // Учитывайте правила ON DELETE RESTRICT на связанных таблицах (sales)
     const { rowCount } = await db.query('DELETE FROM bookings WHERE id = $1', [id]);
     if (rowCount === 0) {
       return res.status(404).json({ error: 'Бронирование не найдено для удаления' });
     }
     res.status(204).send(); // No Content
   } catch (err) {
     console.error(`Ошибка при удалении бронирования ${id}:`, err);
      if (err.code === '23503') { // FK violation (например, если на это бронирование ссылается продажа)
           return res.status(409).json({ error: 'Невозможно удалить бронирование, так как с ним связана продажа.' });
        }
     res.status(500).json({ error: 'Внутренняя ошибка сервера' });
   }
});


// Экспортируем роутер
module.exports = router;
