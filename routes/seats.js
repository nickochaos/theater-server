// routes/seats.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { protect, isAdmin } = require('../middleware/authMiddleware');

// GET /api/seats - Получить места с фильтрацией (Доступно всем авторизованным или вообще всем)
// Фильтры: hall_id, zone_id, row_id
router.get('/', async (req, res) => {
  const { hall_id, zone_id, row_id } = req.query; // Получаем параметры фильтрации
  let sql = `
    SELECT s.id, s.seat_number, s.base_price,
           s.hall_id, h.hall_name,
           s.zone_id, z.zone_name,
           s.row_id, r.row_name
    FROM seats s
    LEFT JOIN halls h ON s.hall_id = h.id
    LEFT JOIN zones z ON s.zone_id = z.id
    LEFT JOIN rows r ON s.row_id = r.id
  `;
  const params = [];
  const conditions = [];

  if (hall_id) {
    if (!/^\d+$/.test(hall_id)) return res.status(400).json({ error: 'Неверный формат hall_id' });
    params.push(hall_id);
    conditions.push(`s.hall_id = $${params.length}`);
  }
   if (zone_id) {
    if (!/^\d+$/.test(zone_id)) return res.status(400).json({ error: 'Неверный формат zone_id' });
    params.push(zone_id);
    conditions.push(`s.zone_id = $${params.length}`);
  }
   if (row_id) {
    if (!/^\d+$/.test(row_id)) return res.status(400).json({ error: 'Неверный формат row_id' });
    params.push(row_id);
    conditions.push(`s.row_id = $${params.length}`);
  }

  // Обязательно требуем хотя бы один фильтр, чтобы не выводить все места сразу
  if (conditions.length === 0) {
       return res.status(400).json({ error: 'Требуется хотя бы один параметр фильтрации (hall_id, zone_id или row_id)' });
  }

  sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY r.id, s.seat_number::int'; // Сортировка по ID ряда и номеру места

  try {
    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка при получении мест:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/seats/:id - Получить конкретное место (Доступно всем авторизованным или вообще всем)
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

// POST /api/seats - Добавить место (Только Админ)
router.post('/', protect, isAdmin, async (req, res) => {
  const { hall_id, zone_id, row_id, seat_number, base_price } = req.body;
  if (!hall_id || !zone_id || !row_id || !seat_number || base_price === undefined) {
    return res.status(400).json({ error: 'Требуются hall_id, zone_id, row_id, seat_number, base_price' });
  }
  if (typeof base_price !== 'number' && !parseFloat(base_price)) {
     return res.status(400).json({ error: 'Базовая цена (base_price) должна быть числом.' });
  }
  try {
    const sql = `
      INSERT INTO seats (hall_id, zone_id, row_id, seat_number, base_price)
      VALUES ($1, $2, $3, $4, $5) RETURNING *`;
    const { rows } = await db.query(sql, [hall_id, zone_id, row_id, seat_number, parseFloat(base_price)]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Ошибка при добавлении места:', err);
     if (err.code === '23503') { // Foreign key violation
       return res.status(400).json({ error: 'Указанный зал, зона или ряд не существуют.' });
     }
     if (err.code === '23505') { // unique constraint violation
       // Вам нужно проверить, какое именно ограничение сработало (если их несколько)
       // Скорее всего, это UNIQUE (hall_id, row_id, seat_number)
       return res.status(409).json({ error: 'Такое место (комбинация зала, ряда, номера) уже существует.' });
     }
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// PUT /api/seats/:id - Обновить место (Только Админ)
router.put('/:id', protect, isAdmin, async (req, res) => {
  const { id } = req.params;
  const { hall_id, zone_id, row_id, seat_number, base_price } = req.body;
  if (!hall_id || !zone_id || !row_id || !seat_number || base_price === undefined) {
    return res.status(400).json({ error: 'Требуются hall_id, zone_id, row_id, seat_number, base_price' });
  }
   if (typeof base_price !== 'number' && !parseFloat(base_price)) {
     return res.status(400).json({ error: 'Базовая цена (base_price) должна быть числом.' });
  }
  try {
    const sql = `
      UPDATE seats SET hall_id = $1, zone_id = $2, row_id = $3, seat_number = $4, base_price = $5
      WHERE id = $6 RETURNING *`;
    const { rows, rowCount } = await db.query(sql, [hall_id, zone_id, row_id, seat_number, parseFloat(base_price), id]);
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

// DELETE /api/seats/:id - Удалить место (Только Админ)
router.delete('/:id', protect, isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
     // Проверьте ON DELETE для tickets.seat_id
    const { rowCount } = await db.query('DELETE FROM seats WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Место не найдено для удаления' });
    }
    res.status(204).send(); // No Content
  } catch (err) {
    console.error(`Ошибка при удалении места ${id}:`, err);
     if (err.code === '23503') { // Foreign key violation
        return res.status(409).json({ error: 'Невозможно удалить место, так как на него есть билеты или брони.' });
    }
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

module.exports = router;
