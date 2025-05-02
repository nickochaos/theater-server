// routes/halls.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/halls
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM halls ORDER BY hall_name');
    res.json(rows);
  } catch (err) {
    console.error('Ошибка при получении залов:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/halls/:id
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query('SELECT * FROM halls WHERE id = $1', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Зал не найден' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(`Ошибка при получении зала ${id}:`, err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// POST /api/halls
router.post('/', async (req, res) => {
  const { hall_name } = req.body;
  if (!hall_name) {
    return res.status(400).json({ error: 'Требуется название зала (hall_name)' });
  }
  try {
    const sql = 'INSERT INTO halls (hall_name) VALUES ($1) RETURNING *';
    const { rows } = await db.query(sql, [hall_name]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Ошибка при добавлении зала:', err);
    if (err.code === '23505') { // unique constraint violation
        return res.status(409).json({ error: `Зал с именем '${hall_name}' уже существует.` });
    }
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// PUT /api/halls/:id
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { hall_name } = req.body;
  if (!hall_name) {
    return res.status(400).json({ error: 'Требуется название зала (hall_name)' });
  }
  try {
    const sql = 'UPDATE halls SET hall_name = $1 WHERE id = $2 RETURNING *';
    const { rows, rowCount } = await db.query(sql, [hall_name, id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Зал не найден для обновления' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(`Ошибка при обновлении зала ${id}:`, err);
     if (err.code === '23505') {
        return res.status(409).json({ error: `Зал с именем '${hall_name}' уже существует.` });
    }
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// DELETE /api/halls/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Учитывайте ON DELETE CASCADE/RESTRICT в seats, schedule
    const { rowCount } = await db.query('DELETE FROM halls WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Зал не найден для удаления' });
    }
    res.status(204).send(); // No Content
  } catch (err) {
    console.error(`Ошибка при удалении зала ${id}:`, err);
     if (err.code === '23503') {
        return res.status(409).json({ error: 'Невозможно удалить зал, так как он используется в местах или расписании.' });
    }
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

module.exports = router;
