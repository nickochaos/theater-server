// routes/bookings.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { protect, isAdmin } = require('../middleware/authMiddleware'); // <-- Импортировали

// GET /api/bookings - Получить бронирования с фильтрацией (Только Админ)
// Этот маршрут возвращает все бронирования (с фильтрами), что небезопасно для обычных пользователей.
router.get('/', protect, isAdmin, async (req, res) => { // <-- Добавлена защита
  const { order_id, schedule_id, ticket_id } = req.query;
  let sql = `
    SELECT b.id, b.schedule_id, b.order_id, b.ticket_id, t.seat_id
    FROM bookings b
    JOIN tickets t ON b.ticket_id = t.id
  `;
  const params = [];
  const conditions = [];

  if (order_id) {
    if (!/^\d+$/.test(order_id)) return res.status(400).json({ error: 'Неверный формат order_id' });
    params.push(order_id);
    conditions.push(`b.order_id = $${params.length}`);
  }
  if (schedule_id) {
     if (!/^\d+$/.test(schedule_id)) return res.status(400).json({ error: 'Неверный формат schedule_id' });
    params.push(schedule_id);
    conditions.push(`b.schedule_id = $${params.length}`);
  }
   if (ticket_id) {
    if (!/^\d+$/.test(ticket_id)) return res.status(400).json({ error: 'Неверный формат ticket_id' });
    params.push(ticket_id);
    conditions.push(`b.ticket_id = $${params.length}`);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  sql += ' ORDER BY b.id';

  try {
    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка при получении бронирований (админ):', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/bookings/:id - Получить бронирование по ID (Только Админ)
// Обычный пользователь получает детали через /api/orders/:id или /api/my-tickets
router.get('/:id', protect, isAdmin, async (req, res) => { // <-- Добавлена защита
   const { id } = req.params;
   if (!/^\d+$/.test(id)) {
       return res.status(400).json({ error: 'Неверный формат ID бронирования' });
   }
   try {
       // Можно добавить JOIN'ы для получения большей информации, если нужно админу
     const { rows } = await db.query('SELECT * FROM bookings WHERE id = $1', [id]);
     if (rows.length === 0) {
       return res.status(404).json({ error: 'Бронирование не найдено' });
     }
     res.json(rows[0]);
   } catch (err) {
     console.error(`Ошибка при получении бронирования ${id} (админ):`, err);
     res.status(500).json({ error: 'Внутренняя ошибка сервера' });
   }
});


// POST /api/bookings - Создать новое бронирование
// ОСТАВЛЕНО БЕЗ ЗАЩИТЫ - предполагается, что вызывается только из доверенных серверных процессов (например, при создании заказа).
// Если планируется прямой вызов из админки - добавьте protect, isAdmin.
router.post('/', async (req, res) => {
    const { schedule_id, order_id, ticket_id } = req.body;

   if (!schedule_id || !order_id || !ticket_id || !/^\d+$/.test(String(schedule_id)) || !/^\d+$/.test(String(order_id)) || !/^\d+$/.test(String(ticket_id))) {
     return res.status(400).json({ error: 'Требуются корректные числовые schedule_id, order_id, ticket_id' });
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
      if (err.code === '23505') { // unique constraint violation
       // Проверьте, какое именно ограничение нарушено (ticket_id или schedule_id, ticket_id)
       return res.status(409).json({ error: 'Этот билет уже забронирован.' });
     }
     res.status(500).json({ error: 'Внутренняя ошибка сервера' });
   }
});

// DELETE /api/bookings/:id (Только Админ)
// Напоминание: Прямое удаление бронирования обычно неверно. Лучше отменять заказ.
router.delete('/:id', protect, isAdmin, async (req, res) => { // <-- Добавлена защита
    const { id } = req.params;
    if (!/^\d+$/.test(id)) {
       return res.status(400).json({ error: 'Неверный формат ID бронирования' });
   }
   try {
     // Учитывайте FK constraints (например, в sales)
     const { rowCount } = await db.query('DELETE FROM bookings WHERE id = $1', [id]);
     if (rowCount === 0) {
       return res.status(404).json({ error: 'Бронирование не найдено для удаления' });
     }
     res.status(204).send(); // No Content
   } catch (err) {
     console.error(`Ошибка при удалении бронирования ${id} (админ):`, err);
      if (err.code === '23503') {
           return res.status(409).json({ error: 'Невозможно удалить бронирование, так как с ним связаны другие данные (например, продажа).' });
        }
     res.status(500).json({ error: 'Внутренняя ошибка сервера' });
   }
});


// Экспортируем роутер
module.exports = router;
