// routes/actors.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/actors - Получить всех актеров
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM actors ORDER BY full_name');
    res.json(rows);
  } catch (err) {
    console.error('Ошибка при получении актеров:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/actors/:id - Получить актера по ID
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query('SELECT * FROM actors WHERE id = $1', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Актер не найден' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(`Ошибка при получении актера ${id}:`, err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// POST /api/actors - Добавить актера
router.post('/', async (req, res) => {
  const { full_name, date_of_birth } = req.body;
  if (!full_name) {
    return res.status(400).json({ error: 'Требуется полное имя (full_name)' });
  }
  try {
    const sql = 'INSERT INTO actors (full_name, date_of_birth) VALUES ($1, $2) RETURNING *';
    const { rows } = await db.query(sql, [full_name, date_of_birth || null]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Ошибка при добавлении актера:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// PUT /api/actors/:id - Обновить актера
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { full_name, date_of_birth } = req.body;
  if (!full_name) {
    return res.status(400).json({ error: 'Требуется полное имя (full_name)' });
  }
  try {
    const sql = 'UPDATE actors SET full_name = $1, date_of_birth = $2 WHERE id = $3 RETURNING *';
    const { rows, rowCount } = await db.query(sql, [full_name, date_of_birth || null, id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Актер не найден для обновления' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(`Ошибка при обновлении актера ${id}:`, err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// DELETE /api/actors/:id - Удалить актера
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Учитывайте ON DELETE CASCADE в performance_roles
    const { rowCount } = await db.query('DELETE FROM actors WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Актер не найден для удаления' });
    }
    res.status(204).send(); // No Content
  } catch (err) {
    console.error(`Ошибка при удалении актера ${id}:`, err);
     if (err.code === '23503') { // Если где-то есть RESTRICT
        return res.status(409).json({ error: 'Невозможно удалить актера, так как он связан с другими данными.' });
    }
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

module.exports = router;
