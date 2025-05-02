// routes/seats.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/seats - Получить все места (может быть очень много, нужна фильтрация!)
// Пример: GET /api/seats?hall_id=1
router.get('/', async (req, res) => {
  const { hall_id, zone_id, row_id } = req.query; // Получаем параметры фильтрации
  let sql = `
    SELECT s.id, s.seat_number, s.base_price,
           h.hall_name, z.zone_name, r.row_name
    FROM seats s
    LEFT JOIN halls h ON s.hall_id = h.id
    LEFT JOIN zones z ON s.zone_id = z.id
    LEFT JOIN rows r ON s.row_id = r.id
  `;
  const params = [];
  const conditions = [];

  if (hall_id) {
    params.push(hall_id);
    conditions.push(`s.hall_id = $${params.length}`);
  }
   if (zone_id) {
    params.push(zone_id);
    conditions.push(`s.zone_id = $${params.length}`);
  }
   if (row_id) {
    params.push(row_id);
    conditions.push(`s.row_id = $${params.length}`);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  sql += ' ORDER BY h.hall_name, r.row_name, s.seat_number::int'; // Пример сортировки

  try {
    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка при получении мест:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/seats/:id - Получить конкретное место
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
     const { rows } = await db.query(`
        SELECT s.id, s.seat_number, s.base_price, s.hall_id, s.zone_id, s.row_id,
               h.hall_name, z.zone_name, r.row_name
        FROM seats s
        LEFT JOIN halls h ON s.hall_id = h.id
        LEFT JOIN zones z ON s.zone_id = z.id
        LEFT JOIN rows r ON s.row_id = r.id
        WHERE s.id = $1
    `, [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Место не найдено' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(`Ошибка при получении места ${id}:`, err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// POST /api/seats - Добавить место
router.post('/', async (req, res) => {
  const { hall_id, zone_id, row_id, seat_number, base_price } = req.body;
  if (!hall_id || !zone_id || !row_id || !seat_number || base_price === undefined) {
    return res.status(400).json({ error: 'Требуются hall_id, zone_id, row_id, seat_number, base_price' });
  }
  try {
    const sql = `
      INSERT INTO seats (hall_id, zone_id, row_id, seat_number, base_price)
      VALUES ($1, $2, $3, $4, $5) RETURNING *`;
    const { rows } = await db.query(sql, [hall_id, zone_id, row_id, seat_number, base_price]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Ошибка при добавлении места:', err);
     if (err.code === '23503') {
       return res.status(400).json({ error: 'Указанный зал, зона или ряд не существуют.' });
     }
     if (err.code === '23505') { // unique constraint
       return res.status(409).json({ error: 'Такое место (комбинация зала, ряда, номера) уже существует.' });
     }
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// PUT /api/seats/:id - Обновить место
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { hall_id, zone_id, row_id, seat_number, base_price } = req.body;
  if (!hall_id || !zone_id || !row_id || !seat_number || base_price === undefined) {
    return res.status(400).json({ error: 'Требуются hall_id, zone_id, row_id, seat_number, base_price' });
  }
  try {
    const sql = `
      UPDATE seats SET hall_id = $1, zone_id = $2, row_id = $3, seat_number = $4, base_price = $5
      WHERE id = $6 RETURNING *`;
    const { rows, rowCount } = await db.query(sql, [hall_id, zone_id, row_id, seat_number, base_price, id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Место не найдено для обновления' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(`Ошибка при обновлении места ${id}:`, err);
     if (err.code === '23503') {
       return res.status(400).json({ error: 'Указанный зал, зона или ряд не существуют.' });
     }
     if (err.code === '23505') {
       return res.status(409).json({ error: 'Такое место (комбинация зала, ряда, номера) уже существует.' });
     }
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// DELETE /api/seats/:id - Удалить место
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
     // Учитывайте ON DELETE RESTRICT в tickets
    const { rowCount } = await db.query('DELETE FROM seats WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Место не найдено для удаления' });
    }
    res.status(204).send(); // No Content
  } catch (err) {
    console.error(`Ошибка при удалении места ${id}:`, err);
     if (err.code === '23503') {
        return res.status(409).json({ error: 'Невозможно удалить место, так как на него есть билеты или брони.' });
    }
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

module.exports = router;
