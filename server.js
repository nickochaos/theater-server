const express = require('express');
const app = express();
const port = 3000; // Порт, на котором будет работать сервер

// Middleware для обработки JSON-тел запросов
app.use(express.json());

// Временное хранилище для данных о спектаклях (пока без базы данных)
let shows = [
  { id: 1, title: 'Пример Спектакля 1', date: '2025-05-10' },
  { id: 2, title: 'Пример Спектакля 2', date: '2025-05-15' }
];

// Счетчик для генерации ID новых спектаклей
let nextShowId = 3;

// --- API Маршруты ---

// GET /api/shows - Получить список всех спектаклей
app.get('/api/shows', (req, res) => {
  res.json(shows); // Отправляем массив спектаклей в формате JSON
});

// GET /api/shows/:id - Получить конкретный спектакль по ID
app.get('/api/shows/:id', (req, res) => {
  const showId = parseInt(req.params.id); // Получаем ID из параметров URL
  const show = shows.find(s => s.id === showId); // Ищем спектакль по ID

  if (show) {
    res.json(show); // Если нашли, отправляем его
  } else {
    res.status(404).send('Спектакль не найден'); // Иначе отправляем ошибку 404
  }
});

// POST /api/shows - Добавить новый спектакль
app.post('/api/shows', (req, res) => {
  const newShow = {
    id: nextShowId++, // Генерируем новый ID
    title: req.body.title, // Получаем название из тела запроса
    date: req.body.date   // Получаем дату из тела запроса
  };

  if (!newShow.title || !newShow.date) {
      return res.status(400).send('Требуется название и дата для спектакля.');
  }

  shows.push(newShow); // Добавляем новый спектакль в массив
  res.status(201).json(newShow); // Отправляем созданный спектакль с статусом 201 (Created)
});

// TODO: Добавить маршруты для PUT (редактирование) и DELETE (удаление)

// Запуск сервера
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
});