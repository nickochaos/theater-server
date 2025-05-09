// routes/zones.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { protect, isAdmin } = require('../middleware/authMiddleware');

// GET /api/zones - Получить все зоны (Доступно всем авторизованным или вообще всем)
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM zones ORDER BY zone_name');
    res.json(rows);
  } catch (err) {
    console.error('Ошибка при получении зон:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/zones/:id - Получить зону по ID (Доступно всем авторизованным или вообще всем)
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query('SELECT * FROM zones WHERE id = $1', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Зона не найдена' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(`Ошибка при получении зоны ${id}:`, err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// POST /api/zones - Добавить новую зону (Только Админ)
router.post('/', protect, isAdmin, async (req, res) => {
  const { zone_name, price_multiplier } = req.body;
  if (!zone_name || price_multiplier === undefined) {
    return res.status(400).json({ error: 'Требуется название зоны (zone_name) и множитель цены (price_multiplier)' });
  }
  if (typeof price_multiplier !== 'number' && !parseFloat(price_multiplier)) {
     return res.status(400).json({ error: 'Множитель цены (price_multiplier) должен быть числом.' });
  }
  try {
    const sql = 'INSERT INTO zones (zone_name, price_multiplier) VALUES ($1, $2) RETURNING *';
    const { rows } = await db.query(sql, [zone_name, parseFloat(price_multiplier)]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Ошибка при добавлении зоны:', err);
    // Можно добавить проверку на уникальность zone_name, если нужно
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// PUT /api/zones/:id - Обновить зону (Только Админ)
router.put('/:id', protect, isAdmin, async (req, res) => {
  const { id } = req.params;
  const { zone_name, price_multiplier } = req.body;
   if (!zone_name || price_multiplier === undefined) {
    return res.status(400).json({ error: 'Требуется название зоны (zone_name) и множитель цены (price_multiplier)' });
  }
   if (typeof price_multiplier !== 'number' && !parseFloat(price_multiplier)) {
     return res.status(400).json({ error: 'Множитель цены (price_multiplier) должен быть числом.' });
  }
  try {
    const sql = 'UPDATE zones SET zone_name = $1, price_multiplier = $2 WHERE id = $3 RETURNING *';
    const { rows, rowCount } = await db.query(sql, [zone_name, parseFloat(price_multiplier), id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Зона не найдена для обновления' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(`Ошибка при обновлении зоны ${id}:`, err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// DELETE /api/zones/:id - Удалить зону (Только Админ)
router.delete('/:id', protect, isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
     // Проверьте ON DELETE для seats.zone_id
    const { rowCount } = await db.query('DELETE FROM zones WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Зона не найдена для удаления' });
    }
    res.status(204).send(); // No Content
  } catch (err) {
    console.error(`Ошибка при удалении зоны ${id}:`, err);
     if (err.code === '23503') {
        return res.status(409).json({ error: 'Невозможно удалить зону, так как она используется в местах.' });
    }
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

module.exports = router;
