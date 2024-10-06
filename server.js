/* const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const { addRowToSheet } = require('./googleSheetsManager');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const storage = multer.memoryStorage();
const upload = multer({ storage: storage, limits: { fileSize: 50 * 1024 * 1024 } });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY не установлен');
  process.exit(1);
}

const tasks = new Map();

function analyzeAIResponse(response) {
  const analysis = {
    "Привітання": 0,
    "Задані усі питання по скрипту": 0,
    "Виявлена потреба": 0,
    "Виявлена мотивація": 0,
    "Виявлений біль": 0,
    "Презентація продукту": 0,
    "Закриття на клоузера": 0,
    "Оброблені заперечення": 0,
    "Підсумкова оцінка": 0,
    "Якість обробленого ліда": 0,
    "Коментар": "",
  };

  const lines = response.split('\n');

  for (const line of lines) {
    for (const [key, value] of Object.entries(analysis)) {
      if (line.toLowerCase().includes(key.toLowerCase())) {
        if (typeof value === 'number') {
          const match = line.match(/(\d+(\.\d+)?)/);
          if (match) {
            analysis[key] = parseFloat(match[0]);
          }
        } else {
          const colonIndex = line.indexOf(':');
          if (colonIndex !== -1) {
            analysis[key] += line.substring(colonIndex + 1).trim() + ' ';
          }
        }
      }
    }
  }

  // Якщо коментар не знайдено, використовуємо весь текст відповіді
  if (!analysis["Коментар"]) {
    analysis["Коментар"] = response;
  }

  return analysis;
}

app.post('/api/send-to-sheet', async (req, res) => {
  try {
    console.log('Отримані дані для відправки:', JSON.stringify(req.body, null, 2));
    const { manager, date, phoneNumber, analysisData } = req.body;
    
    if (!manager) {
      return res.status(400).json({ success: false, error: 'Не вибрано ім\'я менеджера' });
    }

    if (!date || !phoneNumber) {
      return res.status(400).json({ success: false, error: 'Не вказана дата або номер телефону' });
    }

    const result = await addRowToSheet(manager, date, phoneNumber, analysisData);
    console.log('Результат відправки:', result);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Помилка при відправці даних в таблицю:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/start-analysis', upload.single('file'), async (req, res) => {
  try {
    console.log('Отримано запит на початок аналізу');
    
    if (!req.file) {
      console.log('Файл не завантажено');
      return res.status(400).json({ error: 'Файл не завантажено' });
    }

    const taskId = uuidv4();
    const model = 'chatgpt-4o-latest';
    
    tasks.set(taskId, { 
      status: 'processing', 
      progress: 0,
      file: req.file.buffer,
      model: model 
    });

    console.log(`Завдання створено: ${taskId}`);
    
    res.json({ taskId });

    processAudio(taskId).catch(error => {
      console.error('Помилка в processAudio:', error);
      tasks.set(taskId, { status: 'failed', progress: 100, error: error.message });
    });

  } catch (error) {
    console.error('Помилка в start-analysis:', error);
    res.status(500).json({ error: 'Внутрішня помилка сервера', details: error.message });
  }
});

app.get('/api/task-status/:taskId', (req, res) => {
  const taskId = req.params.taskId;
  const task = tasks.get(taskId);

  if (!task) {
    return res.status(404).json({ error: 'Завдання не знайдено' });
  }

  res.json(task);
});

app.get('/api/get-prompt', async (req, res) => {
  try {
    const promptPath = path.resolve(__dirname, 'prompt.js');
    const promptContent = await fs.readFile(promptPath, 'utf8');
    res.send(promptContent);
  } catch (error) {
    console.error('Помилка при читанні промпту:', error);
    res.status(500).json({ error: 'Помилка при читанні промпту' });
  }
});

app.post('/api/update-prompt', async (req, res) => {
  try {
    const { prompt } = req.body;
    const promptPath = path.resolve(__dirname, 'prompt.js');
    await fs.writeFile(promptPath, prompt, 'utf8');
    res.json({ success: true, message: 'Промпт успішно оновлено' });
  } catch (error) {
    console.error('Помилка при оновленні промпту:', error);
    res.status(500).json({ error: 'Помилка при оновленні промпту' });
  }
});

async function processAudio(taskId) {
  const task = tasks.get(taskId);
  
  try {
    console.log(`Початок обробки аудіо для завдання ${taskId}`);
    
    updateTaskProgress(taskId, 30);
    console.log(`Початок транскрибації аудіо для завдання ${taskId}`);
    const transcript = await transcribeAudio(task.file);
    console.log(`Транскрибація завершена для завдання ${taskId}`);
    
    updateTaskProgress(taskId, 60);
    console.log(`Початок аналізу транскрипту для завдання ${taskId}`);
    const analysis = await analyzeTranscript(transcript, task.model);
    console.log(`Аналіз завершено для завдання ${taskId}`);
    
    tasks.set(taskId, {
      status: 'completed',
      progress: 100,
      analysis: analysis
    });
    console.log(`Завдання ${taskId} успішно завершено`);
  } catch (error) {
    console.error(`Помилка обробки аудіо для завдання ${taskId}:`, error);
    tasks.set(taskId, { 
      status: 'failed', 
      progress: 100, 
      error: error.message,
      details: error.stack
    });
  }
}

async function transcribeAudio(audioBuffer) {
  const formData = new FormData();
  formData.append('file', audioBuffer, { filename: 'audio.mp3', contentType: 'audio/mpeg' });
  formData.append('model', 'whisper-1');
  formData.append('language', 'uk');

  try {
    const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
      headers: {
        ...formData.getHeaders(),
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    return response.data.text;
  } catch (error) {
    console.error('Помилка в transcribeAudio:', error);
    throw new Error('Помилка при транскрибації аудіо');
  }
}

async function analyzeTranscript(transcript, model) {
  try {
    const promptPath = path.resolve(__dirname, 'prompt.js');
    const promptContent = await fs.readFile(promptPath, 'utf8');

    const filledPrompt = promptContent.replace('${transcript}', transcript);

    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: model,
      messages: [
        { role: 'system', content: 'Ви - експерт з аналізу продажних дзвінків. Надайте розгорнутий аналіз, включаючи оцінку голосу, емоцій та загальне враження. Відповідайте українською мовою. Ваша відповідь повинна містити числові оцінки для кожного критерію від 0 до 1, де 0 - повна відсутність, 1 - ідеальне виконання.' },
        { role: 'user', content: filledPrompt }
      ],
      max_tokens: 4000  // Збільшуємо ліміт токенів для отримання більш повної відповіді
    }, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const analysisText = response.data.choices[0].message.content;
    console.log('Відповідь GPT:', analysisText);

    const parsedAnalysis = analyzeAIResponse(analysisText);

    return {
      analysis: analysisText,
      parsedData: parsedAnalysis
    };
  } catch (error) {
    console.error('Помилка в analyzeTranscript:', error);
    throw new Error(`Помилка при аналізі транскрипту: ${error.message}`);
  }
}

function updateTaskProgress(taskId, progress) {
  const task = tasks.get(taskId);
  if (task) {
    task.progress = progress;
    tasks.set(taskId, task);
  }
}

// Обробник помилок
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Щось пішло не так!');
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Сервер запущено на порту ${port}`);
}); */


require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs').promises;
const { addRowToSheet } = require('./googleSheetsApi');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const storage = multer.memoryStorage();
const upload = multer({ storage: storage, limits: { fileSize: 50 * 1024 * 1024 } });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY не встановлено');
  process.exit(1);
}

const tasks = new Map();

app.post('/api/send-to-sheet', async (req, res) => {
  try {
    console.log('Отримано запит на відправку даних в таблицю:', JSON.stringify(req.body, null, 2));
    const { manager, date, phoneNumber, analysisData } = req.body;
    
    if (!manager || !date || !phoneNumber || !analysisData || !analysisData.structuredData) {
      console.error('Не всі необхідні дані присутні в запиті');
      return res.status(400).json({ success: false, error: 'Не вказані обов\'язкові поля' });
    }
    
    const dataToSend = {
      date,
      phoneNumber,
      ...analysisData.structuredData
    };
    
    console.log('Дані для відправки в таблицю (розгорнуто):', JSON.stringify(dataToSend, null, 2));
    
    const result = await addRowToSheet(manager, dataToSend);
    
    console.log('Результат відправки:', result);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Детальна помилка при відправці даних в таблицю:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack,
      details: error.response ? error.response.data : null
    });
  }
});
app.post('/api/start-analysis', upload.single('file'), async (req, res) => {
  try {
    console.log('Отримано запит на початок аналізу');
    
    if (!req.file) {
      console.log('Файл не завантажено');
      return res.status(400).json({ error: 'Файл не завантажено' });
    }

    const taskId = uuidv4();
    const model = 'gpt-4o-2024-05-13'; //o1-preview  //gpt-4o-2024-08-06 //gpt-4o-2024-05-13
    
    tasks.set(taskId, { 
      status: 'processing', 
      progress: 0,
      file: req.file.buffer,
      model: model,
      temperature: 0,
    });

    console.log(`Завдання створено: ${taskId}`);
    
    res.json({ taskId });

    processAudio(taskId).catch(error => {
      console.error('Помилка в processAudio:', error);
      tasks.set(taskId, { status: 'failed', progress: 100, error: error.message });
    });

  } catch (error) {
    console.error('Помилка в start-analysis:', error);
    res.status(500).json({ error: 'Внутрішня помилка сервера', details: error.message });
  }
});

app.get('/api/task-status/:taskId', (req, res) => {
  const taskId = req.params.taskId;
  const task = tasks.get(taskId);

  if (!task) {
    return res.status(404).json({ error: 'Завдання не знайдено' });
  }

  res.json(task);
});

async function processAudio(taskId) {
  const task = tasks.get(taskId);
  
  try {
    console.log(`Початок обробки аудіо для завдання ${taskId}`);
    
    updateTaskProgress(taskId, 30);
    console.log(`Початок транскрибації аудіо для завдання ${taskId}`);
    const transcript = await transcribeAudio(task.file);
    console.log(`Транскрибація завершена для завдання ${taskId}`);
    
    updateTaskProgress(taskId, 60);
    console.log(`Початок аналізу транскрипту для завдання ${taskId}`);
    const analysis = await analyzeTranscript(transcript, task.model);
    console.log(`Аналіз завершено для завдання ${taskId}`);
    
    tasks.set(taskId, {
      status: 'completed',
      progress: 100,
      analysis: analysis
    });
    console.log(`Завдання ${taskId} успішно завершено`);
  } catch (error) {
    console.error(`Помилка обробки аудіо для завдання ${taskId}:`, error);
    tasks.set(taskId, { 
      status: 'failed', 
      progress: 100, 
      error: error.message,
      details: error.stack
    });
  }
}

async function transcribeAudio(audioBuffer) {
  const formData = new FormData();
  formData.append('file', audioBuffer, { filename: 'audio.mp3', contentType: 'audio/mpeg' });
  formData.append('model', 'whisper-1');
  formData.append('language', 'uk');

  try {
    const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
      headers: {
        ...formData.getHeaders(),
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    return response.data.text;
  } catch (error) {
    console.error('Помилка в transcribeAudio:', error);
    throw new Error('Помилка при транскрибації аудіо: ' + error.message);
  }
}

async function analyzeTranscript(transcript, model) {
  const maxRetries = 3;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      const promptPath = path.resolve(__dirname, 'prompt.js');
      const promptContent = await fs.readFile(promptPath, 'utf8');

      const filledPrompt = promptContent.replace('${transcript}', transcript);

      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: model,
        messages: [
          { role: 'system', content: 'Ви - експерт з аналізу продажних дзвінків. Надайте розгорнутий аналіз, включаючи оцінку голосу, емоцій та загальне враження. Відповідайте українською мовою. Оцінюйте кожен критерій ЛИШЕ як 0 або 1.' },
          { role: 'user', content: filledPrompt }
        ],
        max_tokens: 4000,
        temperature: 0,
      }, {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      const content = response.data.choices[0].message.content;
      
      console.log('Повний ответ от ИИ:');
      console.log(content);
      
      const parsedResult = parseAnalysis(content);
      console.log('Обработанный результат:');
      console.log(JSON.stringify(parsedResult, null, 2));
      
      return parsedResult;
    } catch (error) {
      if (error.response && error.response.status === 429) {
        retryCount++;
        console.log(`Помилка 429. Спроба ${retryCount} з ${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, 2 ** retryCount * 1000));
      } else {
        console.error('Помилка в analyzeTranscript:', error);
        throw new Error(`Помилка при аналізі транскрипту: ${error.message}`);
      }
    }
  }
  
  throw new Error('Перевищено максимальну кількість спроб');
}

function parseAnalysis(content) {
  const result = {
    structuredData: {},
    detailedReview: ''
  };
  let currentSection = '';

  const lines = content.split('\n');

  for (const line of lines) {
    if (line.startsWith('1. ДАНІ ДЛЯ ТАБЛИЦІ')) {
      currentSection = 'tableData';
      continue;
    } else if (line.startsWith('2. ДАНІ ДЛЯ ВІДОБРАЖЕННЯ НА ЕКРАНІ')) {
      currentSection = 'screenData';
      continue;
    } else if (line.startsWith('3. Емоційний стан та особливості голосу')) {
      currentSection = 'emotionalAnalysis';
      continue;
    }

    if (currentSection === 'tableData') {
      const [key, valueStr] = line.split(':').map(s => s.trim());
      if (key && valueStr) {
        if (key === 'Загальний коментар') {
          result.structuredData[key] = valueStr;
        } else {
          let value = parseFloat(valueStr);
          if (!isNaN(value)) {
            if (key === 'Якість обробленого ліда') {
              value = parseFloat(value.toFixed(2));
            } else if (key !== 'Підсумкова оцінка') {
              value = value >= 0.5 ? 1 : 0;
            }
            result.structuredData[key] = value;
          }
        }
      }
    } else if (currentSection === 'screenData' || currentSection === 'emotionalAnalysis') {
      result.detailedReview += line + '\n';
    }
  }

  result.detailedReview = result.detailedReview.trim();

  return result;
}
function updateTaskProgress(taskId, progress) {
  const task = tasks.get(taskId);
  if (task) {
    task.progress = progress;
    tasks.set(taskId, {...task, progress});
  }
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Сервер запущено на порту ${port}`);
});