// routes/tickets.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/tickets (вероятно, не очень полезен без контекста заказа/брони)
router.get('/', async (req, res) => {
  // Добавьте фильтры, если нужно, например по seat_id
  try {
    const { rows } = await db.query('SELECT * FROM tickets');
    res.json(rows);
  } catch (err) {
    console.error('Ошибка при получении билетов:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/tickets/:id
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query('SELECT * FROM tickets WHERE id = $1', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Билет не найден' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(`Ошибка при получении билета ${id}:`, err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// POST /api/tickets (Вряд ли будет использоваться напрямую)
// Билеты создаются при бронировании/покупке
router.post('/', async (req, res) => {
   const { seat_id, final_price } = req.body;
   if (!seat_id || final_price === undefined) {
     return res.status(400).json({ error: 'Требуются seat_id и final_price' });
   }
   try {
     const sql = 'INSERT INTO tickets (seat_id, final_price) VALUES ($1, $2) RETURNING *';
     const { rows } = await db.query(sql, [seat_id, final_price]);
     res.status(201).json(rows[0]);
   } catch (err) {
     console.error('Ошибка при создании билета:', err);
     if (err.code === '23503') {
       return res.status(400).json({ error: 'Указанное место не существует.' });
     }
     res.status(500).json({ error: 'Внутренняя ошибка сервера' });
   }
});

// DELETE /api/tickets/:id (ОСТОРОЖНО!)
// Обычно билеты не удаляют, если они были забронированы/проданы
router.delete('/:id', async (req, res) => {
   const { id } = req.params;
   try {
     // Учитывайте ON DELETE RESTRICT в bookings, sales
     const { rowCount } = await db.query('DELETE FROM tickets WHERE id = $1', [id]);
     if (rowCount === 0) {
       return res.status(404).json({ error: 'Билет не найден для удаления' });
     }
     res.status(204).send();
   } catch (err) {
     console.error(`Ошибка при удалении билета ${id}:`, err);
     if (err.code === '23503') {
        return res.status(409).json({ error: 'Невозможно удалить билет, так как он используется в бронированиях или продажах.' });
    }
     res.status(500).json({ error: 'Внутренняя ошибка сервера' });
   }
});


module.exports = router;
