// routes/performance_types.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/performance-types
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM performance_types ORDER BY type_name');
    res.json(rows);
  } catch (err) {
    console.error('Ошибка при получении типов представлений:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/performance-types/:id
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query('SELECT * FROM performance_types WHERE id = $1', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Тип представления не найден' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(`Ошибка при получении типа представления ${id}:`, err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// POST /api/performance-types
router.post('/', async (req, res) => {
  const { type_name } = req.body;
  if (!type_name) {
    return res.status(400).json({ error: 'Требуется название типа (type_name)' });
  }
  try {
    const sql = 'INSERT INTO performance_types (type_name) VALUES ($1) RETURNING *';
    const { rows } = await db.query(sql, [type_name]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Ошибка при добавлении типа представления:', err);
     if (err.code === '23505') { // unique constraint violation
        return res.status(409).json({ error: `Тип представления с именем '${type_name}' уже существует.` });
    }
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// PUT /api/performance-types/:id
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { type_name } = req.body;
  if (!type_name) {
    return res.status(400).json({ error: 'Требуется название типа (type_name)' });
  }
  try {
    const sql = 'UPDATE performance_types SET type_name = $1 WHERE id = $2 RETURNING *';
    const { rows, rowCount } = await db.query(sql, [type_name, id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Тип представления не найден для обновления' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(`Ошибка при обновлении типа представления ${id}:`, err);
    if (err.code === '23505') {
        return res.status(409).json({ error: `Тип представления с именем '${type_name}' уже существует.` });
    }
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// DELETE /api/performance-types/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Учитывайте ON DELETE RESTRICT в performances
    const { rowCount } = await db.query('DELETE FROM performance_types WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Тип представления не найден для удаления' });
    }
    res.status(204).send(); // No Content
  } catch (err) {
    console.error(`Ошибка при удалении типа представления ${id}:`, err);
     if (err.code === '23503') {
        return res.status(409).json({ error: 'Невозможно удалить тип, так как он используется в представлениях.' });
    }
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

module.exports = router;
