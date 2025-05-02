// routes/performance_roles.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/performance-roles (Фильтрация обязательна!)
// Пример: /api/performance-roles?performance_id=1 или /api/performance-roles?actor_id=5
router.get('/', async (req, res) => {
  const { performance_id, actor_id, role_type_id } = req.query;
  let sql = `
    SELECT
      pr.id, pr.role_name,
      pr.actor_id, a.full_name as actor_name,
      pr.performance_id, p.title as performance_title,
      pr.performance_role_type_id, prt.type_name as role_type_name
    FROM performance_roles pr
    LEFT JOIN actors a ON pr.actor_id = a.id
    LEFT JOIN performances p ON pr.performance_id = p.id
    LEFT JOIN performance_role_types prt ON pr.performance_role_type_id = prt.id
  `;
  const params = [];
  const conditions = [];

  if (performance_id) {
    params.push(performance_id);
    conditions.push(`pr.performance_id = $${params.length}`);
  }
  if (actor_id) {
    params.push(actor_id);
    conditions.push(`pr.actor_id = $${params.length}`);
  }
  if (role_type_id) {
    params.push(role_type_id);
    conditions.push(`pr.performance_role_type_id = $${params.length}`);
  }

   if (conditions.length === 0) {
     // Избегаем выборки всех ролей без фильтра, это может быть слишком много
     return res.status(400).json({ error: 'Требуется хотя бы один параметр фильтрации (performance_id, actor_id или role_type_id)' });
   }

  sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY p.title, a.full_name, pr.role_name';

  try {
    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка при получении ролей:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/performance-roles/:id
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query(`
      SELECT
        pr.id, pr.role_name,
        pr.actor_id, a.full_name as actor_name,
        pr.performance_id, p.title as performance_title,
        pr.performance_role_type_id, prt.type_name as role_type_name
      FROM performance_roles pr
      LEFT JOIN actors a ON pr.actor_id = a.id
      LEFT JOIN performances p ON pr.performance_id = p.id
      LEFT JOIN performance_role_types prt ON pr.performance_role_type_id = prt.id
      WHERE pr.id = $1
    `, [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Роль в представлении не найдена' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(`Ошибка при получении роли ${id}:`, err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// POST /api/performance-roles
router.post('/', async (req, res) => {
  const { role_name, actor_id, performance_id, performance_role_type_id } = req.body;
  if (!role_name || !actor_id || !performance_id || !performance_role_type_id) {
    return res.status(400).json({ error: 'Требуются role_name, actor_id, performance_id, performance_role_type_id' });
  }
  try {
    const sql = `
      INSERT INTO performance_roles (role_name, actor_id, performance_id, performance_role_type_id)
      VALUES ($1, $2, $3, $4) RETURNING *`;
    const { rows } = await db.query(sql, [role_name, actor_id, performance_id, performance_role_type_id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Ошибка при добавлении роли:', err);
     if (err.code === '23503') { // FK violation
       return res.status(400).json({ error: 'Указанный актер, представление или тип роли не существуют.' });
     }
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// PUT /api/performance-roles/:id
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { role_name, actor_id, performance_id, performance_role_type_id } = req.body;
   if (!role_name || !actor_id || !performance_id || !performance_role_type_id) {
    return res.status(400).json({ error: 'Требуются role_name, actor_id, performance_id, performance_role_type_id' });
  }
  try {
    const sql = `
      UPDATE performance_roles
      SET role_name=$1, actor_id=$2, performance_id=$3, performance_role_type_id=$4
      WHERE id = $5 RETURNING *`;
    const { rows, rowCount } = await db.query(sql, [role_name, actor_id, performance_id, performance_role_type_id, id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Роль в представлении не найдена для обновления' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(`Ошибка при обновлении роли ${id}:`, err);
    if (err.code === '23503') { // FK violation
       return res.status(400).json({ error: 'Указанный актер, представление или тип роли не существуют.' });
     }
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// DELETE /api/performance-roles/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await db.query('DELETE FROM performance_roles WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Роль в представлении не найдена для удаления' });
    }
    res.status(204).send(); // No Content
  } catch (err) {
    console.error(`Ошибка при удалении роли ${id}:`, err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

module.exports = router;
