require('dotenv').config(); 
const db = require('./db'); 

async function cleanupSchedule() {
    console.log(`[${new Date().toISOString()}] Запуск скрипта очистки расписания...`);
    const client = await db.getClient();
    let deletedCount = 0;

    try {
        const sql = `
            DELETE FROM schedule
            WHERE (start_date + INTERVAL '1 day' + end_time) < NOW()
            RETURNING id; -- Возвращаем ID удаленных записей для подсчета
        `;

        const result = await client.query(sql);
        deletedCount = result.rowCount;

        if (deletedCount > 0) {
            console.log(`Успешно удалено ${deletedCount} старых записей из расписания.`);
        } else {
            console.log('Старых записей в расписании для удаления не найдено.');
        }
    } catch (error) {
        console.error('Ошибка при удалении старых записей из расписания:', error);
    } finally {
        if (client) {
            client.release(); 
        }
        await db.pool.end(() => {
             console.log(`[${new Date().toISOString()}] Скрипт очистки расписания завершен.`);
        });
    }
}

cleanupSchedule();
