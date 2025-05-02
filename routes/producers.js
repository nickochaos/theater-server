// routes/producers.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/producers
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM producers ORDER BY full_name');
    res.json(rows);
  } catch (err) {
    console.error('Ошибка при получении продюсеров:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/producers/:id
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query('SELECT * FROM producers WHERE id = $1', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Продюсер не найден' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(`Ошибка при получении продюсера ${id}:`, err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// POST /api/producers
router.post('/', async (req, res) => {
  const { full_name, date_of_birth } = req.body;
  if (!full_name) {
    return res.status(400).json({ error: 'Требуется полное имя (full_name)' });
  }
  try {
    const sql = 'INSERT INTO producers (full_name, date_of_birth) VALUES ($1, $2) RETURNING *';
    const { rows } = await db.query(sql, [full_name, date_of_birth || null]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Ошибка при добавлении продюсера:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// PUT /api/producers/:id
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { full_name, date_of_birth } = req.body;
  if (!full_name) {
    return res.status(400).json({ error: 'Требуется полное имя (full_name)' });
  }
  try {
    const sql = 'UPDATE producers SET full_name = $1, date_of_birth = $2 WHERE id = $3 RETURNING *';
    const { rows, rowCount } = await db.query(sql, [full_name, date_of_birth || null, id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Продюсер не найден для обновления' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(`Ошибка при обновлении продюсера ${id}:`, err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// DELETE /api/producers/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Помните, что удаление продюсера может повлиять на performances (если ON DELETE SET NULL или RESTRICT)
    const { rowCount } = await db.query('DELETE FROM producers WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Продюсер не найден для удаления' });
    }
    res.status(204).send(); // No Content
  } catch (err) {
    console.error(`Ошибка при удалении продюсера ${id}:`, err);
     if (err.code === '23503') {
        return res.status(409).json({ error: 'Невозможно удалить продюсера, так как он связан с представлениями.' });
    }
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

module.exports = router;
