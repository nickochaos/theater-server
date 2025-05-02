// routes/schedule.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/schedule - Получить расписание (нужна фильтрация!)
// Пример: GET /api/schedule?performance_id=1&start_date=2025-05-10
router.get('/', async (req, res) => {
  const { performance_id, hall_id, start_date } = req.query;
  let sql = `
    SELECT sch.id, sch.start_date, sch.start_time, sch.end_time,
           p.title as performance_title, h.hall_name
    FROM schedule sch
    LEFT JOIN performances p ON sch.performance_id = p.id
    LEFT JOIN halls h ON sch.hall_id = h.id
  `;
  const params = [];
  const conditions = [];

  if (performance_id) {
    params.push(performance_id);
    conditions.push(`sch.performance_id = $${params.length}`);
  }
  if (hall_id) {
    params.push(hall_id);
    conditions.push(`sch.hall_id = $${params.length}`);
  }
  if (start_date) {
    // TODO: Добавить валидацию формата даты
    params.push(start_date);
    conditions.push(`sch.start_date = $${params.length}`);
  }
  // Можно добавить фильтрацию по диапазону дат

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  sql += ' ORDER BY sch.start_date, sch.start_time';

  try {
    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка при получении расписания:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/schedule/:id - Получить запись расписания по ID
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query(`
        SELECT sch.id, sch.start_date, sch.start_time, sch.end_time,
               sch.performance_id, sch.hall_id,
               p.title as performance_title, h.hall_name
        FROM schedule sch
        LEFT JOIN performances p ON sch.performance_id = p.id
        LEFT JOIN halls h ON sch.hall_id = h.id
        WHERE sch.id = $1
    `, [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Запись расписания не найдена' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(`Ошибка при получении записи расписания ${id}:`, err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// POST /api/schedule - Добавить запись в расписание
router.post('/', async (req, res) => {
  const { performance_id, hall_id, start_date, start_time, end_time } = req.body;
  if (!performance_id || !hall_id || !start_date || !start_time || !end_time) {
    return res.status(400).json({ error: 'Требуются performance_id, hall_id, start_date, start_time, end_time' });
  }
  // TODO: Добавить валидацию формата даты и времени
  // TODO: Добавить проверку на пересечение времени в зале

  try {
    const sql = `
      INSERT INTO schedule (performance_id, hall_id, start_date, start_time, end_time)
      VALUES ($1, $2, $3, $4, $5) RETURNING *`;
    const { rows } = await db.query(sql, [performance_id, hall_id, start_date, start_time, end_time]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Ошибка при добавлении в расписание:', err);
     if (err.code === '23503') {
       return res.status(400).json({ error: 'Указанное представление или зал не существуют.' });
     }
      if (err.code === '23505') { // unique constraint (hall_id, start_date, start_time)
       return res.status(409).json({ error: 'В это время в этом зале уже запланировано событие.' });
     }
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// PUT /api/schedule/:id - Обновить запись расписания
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { performance_id, hall_id, start_date, start_time, end_time } = req.body;
   if (!performance_id || !hall_id || !start_date || !start_time || !end_time) {
    return res.status(400).json({ error: 'Требуются performance_id, hall_id, start_date, start_time, end_time' });
  }
  // TODO: Валидация и проверка пересечений

  try {
    const sql = `
      UPDATE schedule SET performance_id=$1, hall_id=$2, start_date=$3, start_time=$4, end_time=$5
      WHERE id = $6 RETURNING *`;
    const { rows, rowCount } = await db.query(sql, [performance_id, hall_id, start_date, start_time, end_time, id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Запись расписания не найдена для обновления' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(`Ошибка при обновлении расписания ${id}:`, err);
    if (err.code === '23503') {
       return res.status(400).json({ error: 'Указанное представление или зал не существуют.' });
     }
      if (err.code === '23505') {
       return res.status(409).json({ error: 'В это время в этом зале уже запланировано событие.' });
     }
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// DELETE /api/schedule/:id - Удалить запись из расписания
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
     // Учитывайте ON DELETE RESTRICT/CASCADE в bookings
    const { rowCount } = await db.query('DELETE FROM schedule WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Запись расписания не найдена для удаления' });
    }
    res.status(204).send(); // No Content
  } catch (err) {
    console.error(`Ошибка при удалении из расписания ${id}:`, err);
     if (err.code === '23503') {
        return res.status(409).json({ error: 'Невозможно удалить событие, так как на него есть бронирования.' });
    }
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

module.exports = router;
