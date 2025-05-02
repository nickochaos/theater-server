// routes/reservations.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { protect, isAdmin } = require('../middleware/authMiddleware');

// POST /api/reservations - Заблокировать место для сеанса (только админ)
router.post('/', protect, isAdmin, async (req, res) => {
    const { seat_id, schedule_id, reservation_type, notes } = req.body;
    const adminUserId = req.user.id; // ID админа из токена

    if (!seat_id || !schedule_id) {
        return res.status(400).json({ error: 'Требуются seat_id и schedule_id' });
    }

    // TODO: Добавить проверку, что место не занято в bookings

    try {
        const sql = `
            INSERT INTO seat_reservations (seat_id, schedule_id, reservation_type, notes, user_id)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *`;
        const { rows } = await db.query(sql, [
            seat_id,
            schedule_id,
            reservation_type || 'blocked_by_admin', // Тип по умолчанию
            notes || null,
            adminUserId
        ]);
        res.status(201).json(rows[0]);
    } catch (err) {
        console.error('Ошибка при блокировке места:', err);
        if (err.code === '23503') { // FK violation
             return res.status(404).json({ error: 'Указанное место или сеанс не найдены.' });
        }
        if (err.code === '23505') { // unique constraint (seat_id, schedule_id)
            return res.status(409).json({ error: 'Это место уже заблокировано или забронировано для данного сеанса.' });
        }
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// DELETE /api/reservations/:id - Снять блокировку/резервацию (только админ)
router.delete('/:id', protect, isAdmin, async (req, res) => {
    const reservationId = req.params.id;

    try {
        const { rowCount } = await db.query('DELETE FROM seat_reservations WHERE id = $1', [reservationId]);
        if (rowCount === 0) {
            return res.status(404).json({ error: 'Блокировка/резервация не найдена' });
        }
        res.status(204).send(); // No Content
    } catch (err) {
        console.error(`Ошибка при снятии блокировки ${reservationId}:`, err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Альтернативный DELETE по seat_id и schedule_id (может быть удобнее для UI)
// DELETE /api/reservations?seat_id=X&schedule_id=Y
router.delete('/', protect, isAdmin, async (req, res) => {
    const { seat_id, schedule_id } = req.query;
    if (!seat_id || !schedule_id) {
         return res.status(400).json({ error: 'Требуются параметры seat_id и schedule_id' });
    }
    try {
        const { rowCount } = await db.query(
            'DELETE FROM seat_reservations WHERE seat_id = $1 AND schedule_id = $2',
            [seat_id, schedule_id]
        );
        if (rowCount === 0) {
            // Не ошибка, если блокировки и не было
            return res.status(204).send();
            // Или можно вернуть 404, если считаем, что она должна была быть
            // return res.status(404).json({ error: 'Блокировка/резервация для данного места и сеанса не найдена' });
        }
        res.status(204).send(); // No Content
    } catch (err) {
        console.error(`Ошибка при снятии блокировки для seat ${seat_id}, schedule ${schedule_id}:`, err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});


module.exports = router;
