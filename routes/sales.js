// routes/sales.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/sales (Нужна фильтрация по order_id или ticket_id)
router.get('/', async (req, res) => {
  const { order_id, ticket_id } = req.query;
  let sql = `
    SELECT s.id, s.sale_date, s.total_price, s.payment_method,
           s.order_id, s.ticket_id
    FROM sales s
  `;
  const params = [];
  const conditions = [];

   if (order_id) {
    params.push(order_id);
    conditions.push(`s.order_id = $${params.length}`);
  }
   if (ticket_id) {
    params.push(ticket_id);
    conditions.push(`s.ticket_id = $${params.length}`);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  sql += ' ORDER BY s.sale_date DESC';

  try {
    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка при получении продаж:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/sales/:id
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query('SELECT * FROM sales WHERE id = $1', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Продажа не найдена' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(`Ошибка при получении продажи ${id}:`, err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// POST /api/sales (Вряд ли будет использоваться напрямую)
router.post('/', async (req, res) => {
   const { order_id, ticket_id, total_price, payment_method } = req.body;
   if (!order_id || !ticket_id || total_price === undefined) {
     return res.status(400).json({ error: 'Требуются order_id, ticket_id, total_price' });
   }
   try {
     // sale_date обычно DEFAULT CURRENT_TIMESTAMP
     const sql = `
      INSERT INTO sales (order_id, ticket_id, total_price, payment_method)
      VALUES ($1, $2, $3, $4) RETURNING *`;
     const { rows } = await db.query(sql, [order_id, ticket_id, total_price, payment_method || null]);
     res.status(201).json(rows[0]);
   } catch (err) {
     console.error('Ошибка при создании продажи:', err);
     if (err.code === '23503') { // FK violation
       return res.status(400).json({ error: 'Указанный заказ или билет не существуют.' });
     }
     if (err.code === '23505') { // unique constraint violation (ticket_id)
       return res.status(409).json({ error: 'Продажа для этого билета уже зарегистрирована.' });
     }
     res.status(500).json({ error: 'Внутренняя ошибка сервера' });
   }
});

// DELETE /api/sales/:id (ОСТОРОЖНО!)
// Обычно продажи не удаляют, а оформляют возврат
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
   try {
     const { rowCount } = await db.query('DELETE FROM sales WHERE id = $1', [id]);
     if (rowCount === 0) {
       return res.status(404).json({ error: 'Продажа не найдена для удаления' });
     }
     res.status(204).send();
   } catch (err) {
     console.error(`Ошибка при удалении продажи ${id}:`, err);
     res.status(500).json({ error: 'Внутренняя ошибка сервера' });
   }
});


module.exports = router;
