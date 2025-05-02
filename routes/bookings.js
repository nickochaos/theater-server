// routes/bookings.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/bookings (Нужна фильтрация по order_id, schedule_id или user_id через JOIN)
router.get('/', async (req, res) => {
  const { order_id, schedule_id, ticket_id } = req.query;
  let sql = 'SELECT * FROM bookings';
  const params = [];
  const conditions = [];

   if (order_id) {
    params.push(order_id);
    conditions.push(`order_id = $${params.length}`);
  }
  if (schedule_id) {
    params.push(schedule_id);
    conditions.push(`schedule_id = $${params.length}`);
  }
   if (ticket_id) {
    params.push(ticket_id);
    conditions.push(`ticket_id = $${params.length}`);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  try {
    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка при получении бронирований:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/bookings/:id
router.get('/:id', async (req, res) => {
  const { id } = req.params;
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

// POST /api/bookings (Вряд ли будет использоваться напрямую)
router.post('/', async (req, res) => {
   const { schedule_id, order_id, ticket_id } = req.body;
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
// Удаление бронирования должно быть частью логики отмены заказа
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
   try {
     const { rowCount } = await db.query('DELETE FROM bookings WHERE id = $1', [id]);
     if (rowCount === 0) {
       return res.status(404).json({ error: 'Бронирование не найдено для удаления' });
     }
     res.status(204).send();
   } catch (err) {
     console.error(`Ошибка при удалении бронирования ${id}:`, err);
     res.status(500).json({ error: 'Внутренняя ошибка сервера' });
   }
});


module.exports = router;
