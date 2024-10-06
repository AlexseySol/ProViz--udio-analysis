const { google } = require('googleapis');
const path = require('path');

const SPREADSHEET_ID = '1XxO7mAKUOiMpZ4Zfgfx8bdcdq9zXY3RYY3WUa0UgiXg';
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');

async function getAuthClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: CREDENTIALS_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return auth.getClient();
}

async function addRowToSheet(manager, data) {
  try {
    console.log('Спроба додати рядок для менеджера:', manager);
    console.log('Дані для додавання:', JSON.stringify(data, null, 2));

    const client = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    const sheetName = getSheetName(manager);
    const range = `${sheetName}!A:M`;

    const values = [
      [
        data.date,
        data.phoneNumber,
        data['Привітання'],
        data['Задані усі питання по скрипту'],
        data['Виявлена потреба'],
        data['Виявлена мотивація'],
        data['Виявлений біль'],
        data['Презентація продукту'],
        data['Закриття на клоузера'],
        data['Оброблені заперечення'],
        data['Підсумкова оцінка'],
        data['Якість обробленого ліда'],
        data['Загальний коментар']
      ]
    ];

    // Ensure numeric values are numbers, not strings
    for (let i = 2; i < 12; i++) {
      if (typeof values[0][i] === 'string') {
        values[0][i] = parseFloat(values[0][i]) || 0; // If parsing fails, default to 0
      }
    }

    // Ensure "Якість обробленого ліда" has two decimal places
    if (values[0][11] !== undefined && values[0][11] !== null) {
      values[0][11] = parseFloat((parseFloat(values[0][11]) || 0).toFixed(2));
    } else {
      values[0][11] = 0;
    }

    console.log('Підготовлені дані для відправки:', values);

    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: range,
      valueInputOption: 'USER_ENTERED',
      resource: { values },
    });

    console.log('Відповідь від Google Sheets API:', response.data);
    return response.data;
  } catch (error) {
    console.error('Помилка при додаванні даних до таблиці:', error);
    throw error;
  }
}

function getSheetName(manager) {
  const sheetNames = {
    'Артем': 'artem',
    'Алексей': 'alexey',
    'Наталия': 'natalia',
    'Анна': 'anna',
    'Анжела': 'angela'
  };
  return sheetNames[manager] || manager.toLowerCase();
}

module.exports = { addRowToSheet };