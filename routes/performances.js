// routes/performances.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { protect, isAdmin } = require('../middleware/authMiddleware'); // Импортируем защиту

// GET /api/performances - Получить список (Доступен всем)
router.get('/', async (req, res) => {
  try {
    // Добавляем новые поля в SELECT
    const { rows } = await db.query(`
      SELECT p.id, p.title, p.description, pt.type_name, pr.full_name as producer_name,
             p.duration_minutes, p.age_restriction
      FROM performances p
      LEFT JOIN performance_types pt ON p.type_id = pt.id
      LEFT JOIN producers pr ON p.producer_id = pr.id
      ORDER BY p.title
    `);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка при получении представлений:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/performances/:id - Получить детали (Доступен всем)
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
     // Добавляем новые поля в SELECT
    const { rows } = await db.query(`
      SELECT p.id, p.title, p.description, p.type_id, pt.type_name, p.producer_id, pr.full_name as producer_name,
             p.duration_minutes, p.age_restriction
      FROM performances p
      LEFT JOIN performance_types pt ON p.type_id = pt.id
      LEFT JOIN producers pr ON p.producer_id = pr.id
      WHERE p.id = $1
    `, [id]);

    if (rows.length === 0) {
      return res.status(404).send('Представление не найдено');
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(`Error fetching performance ${id}:`, err);
    res.status(500).send('Internal Server Error');
  }
});

// POST /api/performances - Добавить (Только админ)
router.post('/', protect, isAdmin, async (req, res) => { // Защищаем маршрут
  // Добавляем duration_minutes, age_restriction
  const { title, type_id, producer_id, description, duration_minutes, age_restriction } = req.body;

  if (!title || !type_id) {
    return res.status(400).send('Требуется название (title) и ID типа (type_id).');
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO performances (title, type_id, producer_id, description, duration_minutes, age_restriction)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [title, type_id, producer_id || null, description || null, duration_minutes || null, age_restriction || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Ошибка при добавлении представления:', err);
    if (err.code === '23503') {
         return res.status(400).send('Указанный тип (type_id) или продюсер (producer_id) не существует.');
    }
    res.status(500).send('Internal Server Error');
  }
});

// PUT /api/performances/:id - Обновить (Только админ)
router.put('/:id', protect, isAdmin, async (req, res) => { // Защищаем маршрут
    const { id } = req.params;
    // Добавляем duration_minutes, age_restriction
    const { title, type_id, producer_id, description, duration_minutes, age_restriction } = req.body;

    if (!title || !type_id) {
        return res.status(400).send('Требуется название (title) и ID типа (type_id).');
    }

    try {
        const { rows, rowCount } = await db.query(
            `UPDATE performances
             SET title = $1, type_id = $2, producer_id = $3, description = $4,
                 duration_minutes = $5, age_restriction = $6
             WHERE id = $7
             RETURNING *`,
            [title, type_id, producer_id || null, description || null, duration_minutes || null, age_restriction || null, id]
        );

        if (rowCount === 0) {
            return res.status(404).send('Представление не найдено для обновления');
        }
        res.json(rows[0]);
    } catch (err) {
        console.error(`Error updating performance ${id}:`, err);
         if (err.code === '23503') {
            return res.status(400).send('Указанный тип (type_id) или продюсер (producer_id) не существует.');
        }
        res.status(500).send('Internal Server Error');
    }
});

// DELETE /api/performances/:id - Удалить (Только админ)
router.delete('/:id', protect, isAdmin, async (req, res) => { // Защищаем маршрут
    const { id } = req.params;
    try {
        const { rowCount } = await db.query('DELETE FROM performances WHERE id = $1', [id]);
        if (rowCount === 0) {
            return res.status(404).send('Представление не найдено для удаления');
        }
        res.status(204).send();
    } catch (err) {
        console.error(`Error deleting performance ${id}:`, err);
        if (err.code === '23503') {
            return res.status(409).send('Невозможно удалить представление, так как оно используется в расписании или ролях.');
        }
        res.status(500).send('Internal Server Error');
    }
});

module.exports = router;
