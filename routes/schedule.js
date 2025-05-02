// routes/schedule.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { protect, isAdmin } = require('../middleware/authMiddleware');

// GET /api/schedule - Получить расписание (Доступен всем)
router.get('/', async (req, res) => {
  // ... (код получения расписания остается как был)
  const { performance_id, hall_id, start_date } = req.query;
  let sql = `
    SELECT sch.id, sch.start_date, sch.start_time, sch.end_time,
           p.title as performance_title, h.hall_name,
           p.duration_minutes, p.age_restriction
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
    params.push(start_date);
    conditions.push(`sch.start_date = $${params.length}`);
  }

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

// GET /api/schedule/:id - Получить детали сеанса (Доступен всем)
router.get('/:id', async (req, res) => {
  // ... (код получения деталей сеанса остается как был, можно добавить новые поля из performances)
   const { id } = req.params;
  try {
    const { rows } = await db.query(`
        SELECT sch.id, sch.start_date, sch.start_time, sch.end_time,
               sch.performance_id, sch.hall_id,
               p.title as performance_title, h.hall_name,
               p.duration_minutes, p.age_restriction
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

// --- НОВЫЙ ЭНДПОИНТ: Получение мест и их статуса для сеанса ---
// GET /api/schedule/:id/seats (Доступен всем, чтобы видеть схему зала)
router.get('/:id/seats', async (req, res) => {
    const scheduleId = req.params.id;

    try {
        // 1. Получить ID зала для данного сеанса
        const scheduleInfo = await db.query('SELECT hall_id FROM schedule WHERE id = $1', [scheduleId]);
        if (scheduleInfo.rows.length === 0) {
            return res.status(404).json({ error: 'Сеанс не найден' });
        }
        const hallId = scheduleInfo.rows[0].hall_id;

        // 2. Получить все места в этом зале и проверить их статус для ДАННОГО сеанса
        const seatsQuery = `
            SELECT
                s.id, s.seat_number, s.base_price,
                r.row_name, z.zone_name, z.price_multiplier as zone_multiplier, r.price_multiplier as row_multiplier,
                -- Определяем статус места для этого сеанса
                CASE
                    WHEN b.id IS NOT NULL THEN 'booked' -- Есть бронь на этот сеанс
                    WHEN sr.id IS NOT NULL THEN sr.reservation_type -- Есть ручная блокировка
                    ELSE 'available'
                END as status,
                sr.notes as reservation_notes, -- Примечание к блокировке
                sr.id as reservation_id        -- ID блокировки (для возможного снятия)
            FROM seats s
            JOIN rows r ON s.row_id = r.id
            JOIN zones z ON s.zone_id = z.id
            -- Ищем бронирования/билеты для ЭТОГО сеанса
            LEFT JOIN tickets t ON t.seat_id = s.id
            LEFT JOIN bookings b ON b.ticket_id = t.id AND b.schedule_id = $1
            -- Ищем ручные блокировки для ЭТОГО сеанса
            LEFT JOIN seat_reservations sr ON sr.seat_id = s.id AND sr.schedule_id = $1
            WHERE s.hall_id = $2
            ORDER BY r.id, s.seat_number::int; -- Сортировка для удобного отображения
        `;
        const { rows } = await db.query(seatsQuery, [scheduleId, hallId]);
        res.json(rows);

    } catch (err) {
        console.error(`Ошибка при получении мест для сеанса ${scheduleId}:`, err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});


// POST /api/schedule - Добавить (Только админ)
router.post('/', protect, isAdmin, async (req, res) => { // Защищаем
    // ... (код добавления остается как был)
    const { performance_id, hall_id, start_date, start_time, end_time } = req.body;
    if (!performance_id || !hall_id || !start_date || !start_time || !end_time) {
      return res.status(400).json({ error: 'Требуются performance_id, hall_id, start_date, start_time, end_time' });
    }
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
        if (err.code === '23505') {
         return res.status(409).json({ error: 'В это время в этом зале уже запланировано событие.' });
       }
      res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// PUT /api/schedule/:id - Обновить (Только админ)
router.put('/:id', protect, isAdmin, async (req, res) => { // Защищаем
  // ... (код обновления остается как был)
  const { id } = req.params;
  const { performance_id, hall_id, start_date, start_time, end_time } = req.body;
   if (!performance_id || !hall_id || !start_date || !start_time || !end_time) {
    return res.status(400).json({ error: 'Требуются performance_id, hall_id, start_date, start_time, end_time' });
  }
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

// DELETE /api/schedule/:id - Удалить (Только админ)
router.delete('/:id', protect, isAdmin, async (req, res) => { // Защищаем
  // ... (код удаления остается как был)
  const { id } = req.params;
  try {
    const { rowCount } = await db.query('DELETE FROM schedule WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Запись расписания не найдена для удаления' });
    }
    res.status(204).send();
  } catch (err) {
    console.error(`Ошибка при удалении из расписания ${id}:`, err);
     if (err.code === '23503') {
        return res.status(409).json({ error: 'Невозможно удалить событие, так как на него есть бронирования.' });
    }
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

module.exports = router;
