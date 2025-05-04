// routes/rows.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { protect, isAdmin } = require('../middleware/authMiddleware');

// GET /api/rows - Получить все ряды (Доступно всем авторизованным или вообще всем)
router.get('/', async (req, res) => {
  try {
    // Естественная сортировка строк может быть сложной ('1', '10', 'A'). Заказываем по ID пока.
    const { rows } = await db.query('SELECT * FROM rows ORDER BY id');
    res.json(rows);
  } catch (err) {
    console.error('Ошибка при получении рядов:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/rows/:id - Получить ряд по ID (Доступно всем авторизованным или вообще всем)
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

// POST /api/rows - Добавить новый ряд (Только Админ)
router.post('/', protect, isAdmin, async (req, res) => {
  const { row_name, price_multiplier } = req.body;
  if (!row_name || price_multiplier === undefined) {
    return res.status(400).json({ error: 'Требуется название ряда (row_name) и множитель цены (price_multiplier)' });
  }
  if (typeof price_multiplier !== 'number' && !parseFloat(price_multiplier)) {
     return res.status(400).json({ error: 'Множитель цены (price_multiplier) должен быть числом.' });
  }
  try {
    const sql = 'INSERT INTO rows (row_name, price_multiplier) VALUES ($1, $2) RETURNING *';
    const { rows } = await db.query(sql, [row_name, parseFloat(price_multiplier)]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Ошибка при добавлении ряда:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// PUT /api/rows/:id - Обновить ряд (Только Админ)
router.put('/:id', protect, isAdmin, async (req, res) => {
  const { id } = req.params;
  const { row_name, price_multiplier } = req.body;
   if (!row_name || price_multiplier === undefined) {
    return res.status(400).json({ error: 'Требуется название ряда (row_name) и множитель цены (price_multiplier)' });
  }
  if (typeof price_multiplier !== 'number' && !parseFloat(price_multiplier)) {
     return res.status(400).json({ error: 'Множитель цены (price_multiplier) должен быть числом.' });
  }
  try {
    const sql = 'UPDATE rows SET row_name = $1, price_multiplier = $2 WHERE id = $3 RETURNING *';
    const { rows, rowCount } = await db.query(sql, [row_name, parseFloat(price_multiplier), id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Ряд не найден для обновления' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(`Ошибка при обновлении ряда ${id}:`, err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// DELETE /api/rows/:id - Удалить ряд (Только Админ)
router.delete('/:id', protect, isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
     // Проверьте ON DELETE для seats.row_id
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
