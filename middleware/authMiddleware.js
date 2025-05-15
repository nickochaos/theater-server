// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const db = require('../db'); 

const protect = async (req, res, next) => {
  let token;


  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const userQuery = await db.query(
          'SELECT id, username, name, surname, email, phone, role FROM users WHERE id = $1',
          [decoded.userId] 
      );

      if (userQuery.rows.length === 0) {
          return res.status(401).json({ error: 'Пользователь токена не найден' });
      }

      req.user = userQuery.rows[0]; 
      next(); 

    } catch (error) {
      console.error('Ошибка верификации токена:', error.message);
      if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({ error: 'Недействительный токен' });
      }
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Срок действия токена истек' });
      }
      return res.status(401).json({ error: 'Не авторизован, ошибка токена' });
    }
  }

  if (!token) {
    res.status(401).json({ error: 'Не авторизован, токен отсутствует' });
  }
};

// Middleware для проверки роли администратора
const isAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ error: 'Доступ запрещен. Требуются права администратора.' });
    }
};


module.exports = { protect, isAdmin };
