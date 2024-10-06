document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('file-input');
    const fileLabel = document.querySelector('.file-label');
    const analyzeButton = document.getElementById('analyze-button');
    const sendToSheetButton = document.getElementById('send-to-sheet-button');
    const statusDiv = document.getElementById('status');
    const resultDiv = document.getElementById('result');
    const managerSelect = document.getElementById('manager-select');
    const dateInput = document.getElementById('date');
    const phoneInput = document.getElementById('phone');

    let analysisResult = null;

    fileInput.addEventListener('change', () => {
        const fileName = fileInput.files[0]?.name || '📁 Додати аудіо';
        fileLabel.textContent = fileName;
        analyzeButton.disabled = !fileInput.files.length;
        
        if (fileInput.files[0]) {
            const nameParts = fileInput.files[0].name.split('_');
            if (nameParts.length >= 3) {
                const [dateStr, timeStr, phoneStr] = nameParts;
                
                const [year, month, day] = dateStr.split('-');
                if (year && month && day) {
                    const formattedDate = `${day}.${month}.${year} ${timeStr.replace('-', ':')}`;
                    dateInput.value = formattedDate;
                }
                
                phoneInput.value = phoneStr.split('.')[0];
            }
        }
    });

    analyzeButton.addEventListener('click', async () => {
        if (!fileInput.files.length) {
            alert('Будь ласка, виберіть аудіо файл');
            return;
        }

        const formData = new FormData();
        formData.append('file', fileInput.files[0]);

        statusDiv.textContent = 'Завантаження файлу...';
        resultDiv.innerHTML = '';
        setFormDisabled(true);

        try {
            const response = await fetch('/api/start-analysis', { method: 'POST', body: formData });
            if (!response.ok) throw new Error(`HTTP помилка! статус: ${response.status}`);
            const { taskId } = await response.json();
            analysisResult = await pollTaskStatus(taskId);
            displayFormattedResults(analysisResult);
            sendToSheetButton.disabled = false;
        } catch (error) {
            console.error('Помилка:', error);
            statusDiv.textContent = `Помилка: ${error.message}`;
            alert(`Виникла помилка під час аналізу: ${error.message}`);
        } finally {
            setFormDisabled(false);
            fileLabel.textContent = '📁 Додати аудіо';
            fileInput.value = '';
        }
    });

    sendToSheetButton.addEventListener('click', async () => {
        if (!analysisResult) {
            alert('Спочатку проведіть аналіз аудіо');
            return;
        }

        if (!managerSelect.value) {
            alert('Будь ласка, виберіть менеджера');
            return;
        }

        try {
            const response = await fetch('/api/send-to-sheet', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    manager: managerSelect.value,
                    date: dateInput.value,
                    phoneNumber: phoneInput.value,
                    analysisData: analysisResult
                })
            });

            if (!response.ok) throw new Error(`HTTP помилка! статус: ${response.status}`);

            const result = await response.json();
            if (result.success) {
                alert('Дані успішно відправлені в Google Таблицю');
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error('Помилка при відправці даних в Google Таблицю:', error);
            alert('Помилка при відправці даних в Google Таблицю: ' + error.message);
        }
    });

    function setFormDisabled(disabled) {
        analyzeButton.disabled = disabled;
        fileInput.disabled = disabled;
        fileLabel.style.pointerEvents = disabled ? 'none' : '';
        fileLabel.style.opacity = disabled ? '0.5' : '';
    }

    async function pollTaskStatus(taskId) {
        const pollInterval = 2000;
        while (true) {
            try {
                const response = await fetch(`/api/task-status/${taskId}`);
                if (!response.ok) throw new Error(`HTTP помилка! статус: ${response.status}`);
                const result = await response.json();
                updateProgressStatus(result.progress);
                if (result.status === 'completed') {
                    statusDiv.textContent = 'Аналіз завершено';
                    return result.analysis;
                } else if (result.status === 'failed') {
                    throw new Error(`Помилка обробки завдання на сервері: ${result.error}`);
                }
                await new Promise(resolve => setTimeout(resolve, pollInterval));
            } catch (error) {
                console.error('Помилка при перевірці статусу:', error);
                statusDiv.textContent = `Помилка: ${error.message}`;
                throw error;
            }
        }
    }

    function updateProgressStatus(progress) {
        statusDiv.textContent = `Обробка файлу... ${progress}%`;
    }

    function displayFormattedResults(analysisData) {
        console.log("Отримані дані аналізу:", analysisData);
    
        let formattedHtml = '<div class="analysis-results">';
        
        if (analysisData.structuredData) {
            formattedHtml += createSummaryScoresSection(analysisData.structuredData);
        }
    
        if (analysisData.detailedReview) {
            formattedHtml += createDetailedAnalysisSection(analysisData.detailedReview);
        }
    
        formattedHtml += '</div>';
        resultDiv.innerHTML = formattedHtml;
    
        addStyles();
    }
    
    function createSummaryScoresSection(structuredData) {
        let html = '<div class="summary-scores card">';
        html += '<h2 class="card-header">Підсумкові оцінки</h2>';
        html += '<div class="card-body">';
        html += '<table class="summary-table">';
        html += '<thead><tr><th>Критерій</th><th>Оцінка</th></tr></thead>';
        html += '<tbody>';
        
        for (const [key, value] of Object.entries(structuredData)) {
            if (key !== 'Загальний коментар') {
                const scoreClass = value === 1 ? 'score-positive' : 'score-negative';
                html += `<tr><td>${key}</td><td class="${scoreClass}">${value}</td></tr>`;
            }
        }
        
        html += '</tbody></table>';
        
        if (structuredData['Загальний коментар']) {
            html += '<div class="general-comment">';
            html += '<h3>Загальний коментар</h3>';
            html += `<p>${structuredData['Загальний коментар']}</p>`;
            html += '</div>';
        }
        
        html += '</div></div>';
        return html;
    }
    
    function createDetailedAnalysisSection(detailedReview) {
        let html = '<div class="detailed-analysis card">';
        html += '<h2 class="card-header">Детальний аналіз</h2>';
        html += '<div class="card-body">';
    
        const sections = detailedReview.split(/\d+\.\s/).filter(Boolean);
        
        sections.forEach((section, index) => {
            if (index === 0) { // Основний аналіз
                const points = section.split('-').filter(Boolean);
                html += '<ul class="analysis-list">';
                points.forEach(point => {
                    const [criterion, description] = point.split(':');
                    if (description) {
                        const score = description.match(/\((\d)\)/) ? description.match(/\((\d)\)/)[1] : '';
                        const scoreClass = score === '1' ? 'score-positive' : 'score-negative';
                        html += `<li><strong>${criterion.trim()}:</strong> ${description.replace(/\(\d\)/, '')} <span class="${scoreClass}">(${score})</span></li>`;
                    } else {
                        html += `<li>${point.trim()}</li>`;
                    }
                });
                html += '</ul>';
            } else if (section.toLowerCase().includes('рекомендації')) {
                html += '<h3>Рекомендації</h3>';
                const recommendations = section.split(/\d+\./).filter(Boolean);
                html += '<ol class="recommendations-list">';
                recommendations.forEach(rec => {
                    html += `<li>${rec.trim()}</li>`;
                });
                html += '</ol>';
            } else {
                html += `<p>${section.trim()}</p>`;
            }
        });
    
        html += '</div></div>';
        return html;
    }
    
    function addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .analysis-results { max-width: 800px; margin: 0 auto; font-family: Arial, sans-serif; }
            .card { background: #ffffff; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            .card-header { background: #007bff; color: white; padding: 15px; border-radius: 8px 8px 0 0; }
            .card-body { padding: 20px; }
            .summary-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
            .summary-table th, .summary-table td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
            .summary-table th { background-color: #f2f2f2; }
            .score-positive { color: #28a745; font-weight: bold; }
            .score-negative { color: #dc3545; font-weight: bold; }
            .analysis-list, .recommendations-list { padding-left: 20px; }
            .analysis-list li, .recommendations-list li { margin-bottom: 15px; }
            h3 { color: #007bff; margin-top: 20px; }
            .general-comment { background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin-top: 20px; }
        `;
        document.head.appendChild(style);
    }
    });