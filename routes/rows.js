// routes/rows.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/rows
router.get('/', async (req, res) => {
  try {
    // Возможно, стоит добавить сортировку, например, по row_name, но она может быть не цифровой
    const { rows } = await db.query('SELECT * FROM rows');
    res.json(rows);
  } catch (err) {
    console.error('Ошибка при получении рядов:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/rows/:id
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query('SELECT * FROM rows WHERE id = $1', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Ряд не найден' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(`Ошибка при получении ряда ${id}:`, err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// POST /api/rows
router.post('/', async (req, res) => {
  const { row_name, price_multiplier } = req.body;
  if (!row_name || price_multiplier === undefined) {
    return res.status(400).json({ error: 'Требуется название ряда (row_name) и множитель цены (price_multiplier)' });
  }
  try {
    const sql = 'INSERT INTO rows (row_name, price_multiplier) VALUES ($1, $2) RETURNING *';
    const { rows } = await db.query(sql, [row_name, price_multiplier]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Ошибка при добавлении ряда:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// PUT /api/rows/:id
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { row_name, price_multiplier } = req.body;
   if (!row_name || price_multiplier === undefined) {
    return res.status(400).json({ error: 'Требуется название ряда (row_name) и множитель цены (price_multiplier)' });
  }
  try {
    const sql = 'UPDATE rows SET row_name = $1, price_multiplier = $2 WHERE id = $3 RETURNING *';
    const { rows, rowCount } = await db.query(sql, [row_name, price_multiplier, id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Ряд не найден для обновления' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(`Ошибка при обновлении ряда ${id}:`, err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// DELETE /api/rows/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
     // Учитывайте ON DELETE RESTRICT в seats
    const { rowCount } = await db.query('DELETE FROM rows WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Ряд не найден для удаления' });
    }
    res.status(204).send(); // No Content
  } catch (err) {
    console.error(`Ошибка при удалении ряда ${id}:`, err);
     if (err.code === '23503') {
        return res.status(409).json({ error: 'Невозможно удалить ряд, так как он используется в местах.' });
    }
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

module.exports = router;
