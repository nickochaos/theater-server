// routes/tickets.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// routes/tickets.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { protect } = require('../middleware/authMiddleware'); // Нужен только protect здесь

const qr = require('qrcode');
const PdfPrinter = require('pdfmake');
const path = require('path');
const fs = require('fs'); // Для проверки существования шрифтов

// --- Настройка PDFMake ---
// Убедитесь, что путь к папке fonts верный относительно корня проекта
const fontsPath = path.join(__dirname, '..', 'fonts');
const fontDescriptors = {
    Roboto: {
        normal: path.join(fontsPath, 'Roboto-Regular.ttf'),
        bold: path.join(fontsPath, 'Roboto-Medium.ttf'), // Используем Medium как Bold
        italics: path.join(fontsPath, 'Roboto-Italic.ttf'),
        bolditalics: path.join(fontsPath, 'Roboto-MediumItalic.ttf')
    }
};
// Проверка существования файлов шрифтов (опционально, для отладки)
Object.values(fontDescriptors.Roboto).forEach(fontPath => {
    if (!fs.existsSync(fontPath)) {
        console.warn(`ВНИМАНИЕ: Файл шрифта не найден: ${fontPath}. Генерация PDF может не работать.`);
    }
});
const printer = new PdfPrinter(fontDescriptors);
// ------------------------

// GET /api/tickets/my-tickets - Получить билеты текущего пользователя
router.get('/my-tickets', protect, async (req, res) => {
    const userId = req.user.id;
    const { limit = 20, page = 1 } = req.query;
    const offset = (page - 1) * limit;

    try {
         // Сначала посчитаем общее количество билетов
         const totalResult = await db.query(
             `SELECT COUNT(t.id)
              FROM tickets t
              JOIN bookings b ON b.ticket_id = t.id
              JOIN orders ord ON b.order_id = ord.id
              WHERE ord.user_id = $1 AND ord.status = 'paid'`, // Только оплаченные
             [userId]
         );
         const totalItems = parseInt(totalResult.rows[0].count, 10);

        // Получаем сами билеты с пагинацией
        const ticketsQuery = `
            SELECT
                t.id as ticket_id, t.final_price,
                s.seat_number, r.row_name, z.zone_name, h.hall_name,
                sch.id as schedule_id, sch.start_date, sch.start_time,
                p.id as performance_id, p.title as performance_title, p.image_filename as performance_image_filename
            FROM tickets t
            JOIN bookings b ON b.ticket_id = t.id
            JOIN orders ord ON b.order_id = ord.id
            JOIN seats s ON t.seat_id = s.id
            JOIN rows r ON s.row_id = r.id
            JOIN zones z ON s.zone_id = z.id
            JOIN halls h ON s.hall_id = h.id
            JOIN schedule sch ON b.schedule_id = sch.id
            JOIN performances p ON sch.performance_id = p.id
            WHERE ord.user_id = $1 AND ord.status = 'paid' -- Только оплаченные
            ORDER BY sch.start_date DESC, sch.start_time DESC, t.id
            LIMIT $2 OFFSET $3
         `;
        const { rows } = await db.query(ticketsQuery, [userId, limit, offset]);

         // Добавляем URL картинки спектакля (если нужно в списке)
         const itemsWithImageUrl = rows.map(ticket => ({
             ...ticket,
             performanceImageUrl: ticket.performance_image_filename
                 ? `${req.protocol}://${req.get('host')}/uploads/performances/${ticket.performance_image_filename}`
                 : null
         }));


        res.json({
            totalPages: Math.ceil(totalItems / limit),
            currentPage: page,
            totalItems: totalItems,
            items: itemsWithImageUrl
        });

    } catch (err) {
        console.error(`Ошибка получения билетов для пользователя ${userId}:`, err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});


// GET /api/tickets/my-tickets/:ticket_id/download - Скачать PDF билета
router.get('/my-tickets/:ticket_id/download', protect, async (req, res) => {
    const ticketId = parseInt(req.params.ticket_id, 10);
    const userId = req.user.id;

    if (isNaN(ticketId)) {
        return res.status(400).json({ error: 'Неверный ID билета' });
    }

    try {
        // 1. Получить все данные билета, ПРОВЕРИВ, что он принадлежит userId и оплачен
         const ticketDataQuery = `
            SELECT
                t.id as ticket_id, t.final_price,
                b.id as booking_id, b.order_id,
                s.seat_number, r.row_name, z.zone_name, h.hall_name,
                sch.start_date, sch.start_time,
                p.title as performance_title, p.age_restriction, p.duration_minutes,
                ord.user_id -- Убедимся, что заказ принадлежит пользователю
            FROM tickets t
            JOIN bookings b ON b.ticket_id = t.id
            JOIN orders ord ON b.order_id = ord.id
            JOIN seats s ON t.seat_id = s.id
            JOIN rows r ON s.row_id = r.id
            JOIN zones z ON s.zone_id = z.id
            JOIN halls h ON s.hall_id = h.id
            JOIN schedule sch ON b.schedule_id = sch.id
            JOIN performances p ON sch.performance_id = p.id
            WHERE t.id = $1 AND ord.user_id = $2 AND ord.status = 'paid' -- Только оплаченные билеты
         `;
        const { rows } = await db.query(ticketDataQuery, [ticketId, userId]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Оплаченный билет не найден или не принадлежит вам.' });
        }
        const ticketData = rows[0];

        // 2. Сгенерировать QR-код
        // Можно включить больше данных или просто уникальный идентификатор
        const qrData = JSON.stringify({
            ticketId: ticketData.ticket_id,
            bookingId: ticketData.booking_id,
            scheduleDate: new Date(ticketData.start_date).toISOString().split('T')[0], // Дата YYYY-MM-DD
            seat: `${ticketData.row_name}-${ticketData.seat_number}`
        });
        const qrCodeImage = await qr.toDataURL(qrData, { errorCorrectionLevel: 'H' });

        // 3. Сформировать определение документа для pdfmake
         const docDefinition = {
            content: [
                { text: 'Электронный Билет', style: 'header' },
                { text: ticketData.performance_title, style: 'subheader' },
                {
                    style: 'infoTable',
                    table: {
                        widths: ['auto', '*'],
                        body: [
                            ['Дата:', `${new Date(ticketData.start_date).toLocaleDateString('ru-RU')}`],
                            ['Время:', `${ticketData.start_time.substring(0, 5)}`],
                            ['Зал:', ticketData.hall_name],
                            ['Ряд:', ticketData.row_name],
                            ['Место:', ticketData.seat_number],
                            ['Зона:', ticketData.zone_name],
                            ['Цена:', `${ticketData.final_price} руб.`],
                            ['Ограничение:', `${ticketData.age_restriction || '-'}`],
                            ['ID Билета:', ticketData.ticket_id] // Для справки
                        ]
                    },
                    layout: 'noBorders'
                },
                 { text: 'Ваш QR-код для прохода:', style: 'qrHeader'},
                { image: qrCodeImage, width: 150, alignment: 'center' }, // Вставляем QR как data URL
                { text: 'Пожалуйста, предъявите этот QR-код на входе в театр.', style: 'footerNote' }
            ],
            styles: {
                header: { fontSize: 20, bold: true, alignment: 'center', margin: [0, 0, 0, 20] },
                subheader: { fontSize: 16, bold: true, alignment: 'center', margin: [0, 0, 0, 15] },
                 infoTable: { margin: [0, 5, 0, 15] },
                 qrHeader: {fontSize: 12, bold: true, alignment: 'center', margin: [0, 15, 0, 5]},
                 footerNote: { fontSize: 10, italics: true, alignment: 'center', margin: [0, 20, 0, 0] }
            },
             defaultStyle: { font: 'Roboto' } // Используем настроенный шрифт
        };

        // 4. Сгенерировать PDF
        const pdfDoc = printer.createPdfKitDocument(docDefinition);

        // 5. Отправить PDF клиенту
        const filename = `theatre-ticket-${ticketData.ticket_id}.pdf`;
        // Устанавливаем заголовки для скачивания
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        // Потоком отправляем PDF в ответ
        pdfDoc.pipe(res);
        pdfDoc.end();

    } catch (err) {
        console.error(`Ошибка при генерации PDF для билета ${ticketId}:`, err);
        res.status(500).json({ error: 'Не удалось сгенерировать билет' });
    }
});

// GET /api/tickets (вероятно, не очень полезен без контекста заказа/брони)
router.get('/', async (req, res) => {
  // Добавьте фильтры, если нужно, например по seat_id
  try {
    const { rows } = await db.query('SELECT * FROM tickets');
    res.json(rows);
  } catch (err) {
    console.error('Ошибка при получении билетов:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/tickets/:id
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query('SELECT * FROM tickets WHERE id = $1', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Билет не найден' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(`Ошибка при получении билета ${id}:`, err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// POST /api/tickets (Вряд ли будет использоваться напрямую)
// Билеты создаются при бронировании/покупке
router.post('/', async (req, res) => {
   const { seat_id, final_price } = req.body;
   if (!seat_id || final_price === undefined) {
     return res.status(400).json({ error: 'Требуются seat_id и final_price' });
   }
   try {
     const sql = 'INSERT INTO tickets (seat_id, final_price) VALUES ($1, $2) RETURNING *';
     const { rows } = await db.query(sql, [seat_id, final_price]);
     res.status(201).json(rows[0]);
   } catch (err) {
     console.error('Ошибка при создании билета:', err);
     if (err.code === '23503') {
       return res.status(400).json({ error: 'Указанное место не существует.' });
     }
     res.status(500).json({ error: 'Внутренняя ошибка сервера' });
   }
});

// DELETE /api/tickets/:id (ОСТОРОЖНО!)
// Обычно билеты не удаляют, если они были забронированы/проданы
router.delete('/:id', async (req, res) => {
   const { id } = req.params;
   try {
     // Учитывайте ON DELETE RESTRICT в bookings, sales
     const { rowCount } = await db.query('DELETE FROM tickets WHERE id = $1', [id]);
     if (rowCount === 0) {
       return res.status(404).json({ error: 'Билет не найден для удаления' });
     }
     res.status(204).send();
   } catch (err) {
     console.error(`Ошибка при удалении билета ${id}:`, err);
     if (err.code === '23503') {
        return res.status(409).json({ error: 'Невозможно удалить билет, так как он используется в бронированиях или продажах.' });
    }
     res.status(500).json({ error: 'Внутренняя ошибка сервера' });
   }
});


module.exports = router;
