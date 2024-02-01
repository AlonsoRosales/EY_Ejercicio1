const express = require('express');
const app = express();
const puppeteer = require('puppeteer');

app.listen(3000, function (){
    console.log("Servidor corriendo en el puerto 3000")
});

//  Endpoint para hacer web scrapping a una fuente
app.get("/search/:source/:entity", async function(req, res){
    const source = req.params.source;
    const entity = req.params.entity;

    // Validamos los parámetros
    if (!entity) {
        return res.status(400).send("El nombre de la entidad no puede estar vacío");
    }
    if (!['1', '2', '3'].includes(source)) {
        return res.status(400).send("El número de Fuente debe ser 1, 2 o 3");
    }

    // WebScrapping de las Fuentes
    try{
        let results;
        switch(source){
            case '1':
                results = await scrapeData("https://offshoreleaks.icij.org/",entity, source);
                break;
            case '2':
                results = await scrapeData("https://projects.worldbank.org/en/projects-operations/procurement/debarred-firms",entity, source);
                break;
            case '3':
                results = await scrapeData("https://sanctionssearch.ofac.treas.gov/",entity, source);
                break;
        }
        res.json(results); 
    }catch(error){
        res.status(500).send(error.message);
    }
});

async function scrapeData(url, entity, source){
    const browser = await puppeteer.launch({
        headless: false,
    });
    const page = await browser.newPage();   
    await page.goto(url);
    
    let results = [];
    let resultsCount = 0;

    switch(source){
        case '1':
            // Interactuamos con el checkbox y el botón de Submit
            await page.waitForSelector('input[type="checkbox"]');
            await page.click('input[type="checkbox"]'); 
            const submitButton = await page.$x("//button[contains(text(), 'Submit')]");
            await submitButton[0].click();

            //Escribimos en el campo de búsqueda y enviamos el form
            await page.type('input[name="q"]', entity);
            await page.click('button[type="submit"]');

            // Esperamos a que los resultados de la búsqueda se carguen
            try {
                await page.waitForSelector('.search__results__table tbody tr');
                
                // Extraemos los datos de los resultados de la búsqueda
                results = await page.evaluate(() => {
                    let data = [];
                    document.querySelectorAll('.search__results__table tbody tr').forEach(row => {
                        const cells = row.querySelectorAll('td');
                        data.push({
                            'Entity': cells[0].innerText.trim(),
                            'Jurisdiction': cells[1] ? cells[1].innerText.trim() : '',
                            'Linked To': cells[2] ? cells[2].innerText.trim() : '',
                            'Data From': cells[3] ? cells[3].innerText.trim() : ''
                        });
                    });
                    return data;
                });
                resultsCount = results.length;
            } catch (e) {
                console.log("No se encontraron elementos.");
            }
            break;

        case '2':
            //  Interactuamos con el campo de categoría y esperamos los resultados
            await page.type('#category', entity);
            await page.waitForTimeout(5000);
             
            try {
                await page.waitForSelector('.k-grid-content.k-auto-scrollable tbody');
                
                //Extraemos los datos de los resultados de búsqueda
                results = await page.evaluate(() => {
                    let data = [];
                    document.querySelectorAll('.k-grid-content.k-auto-scrollable tbody tr').forEach(row => {
                        const cells = row.querySelectorAll('td');
                        data.push({
                            'Firm Name': cells[0].innerText,
                            'Address': cells[2].innerText,
                            'Country': cells[3].innerText,
                            'From Date (Ineligibility Period)': cells[4].innerText,
                            'To Date (Ineligibility Period)': cells[5].innerText,
                            'Grounds': cells[6].innerText,
                        });
                    });
                    return data;
                });
                resultsCount = results.length;
            } catch (e) {
                console.log("No se encontraron elementos.");
            }
            break;

        case '3':
            // Interactuamos con el input y el botón de búsqueda
            await page.type('#ctl00_MainContent_txtLastName', entity);
            await page.click('input[name="ctl00$MainContent$btnSearch"]');
            await page.waitForSelector('#gvSearchResults tr', { visible: true, timeout: 1000 });

            // Esperar a que los resultados de la búsqueda se carguen
            try {
                await page.waitForSelector('#gvSearchResults tr', { visible: true, timeout: 1000 });

                // Extraer los datos de los resultados de la búsqueda
                results = await page.evaluate(() => {
                    let data = [];
                    document.querySelectorAll('#gvSearchResults tr').forEach(row => {
                        const cells = row.querySelectorAll('td');
                        if (cells.length > 0) {
                            data.push({
                                'Name': cells[0].innerText,
                                'Address': cells[1].innerText,
                                'Type': cells[2].innerText,
                                'Program(s)': cells[3].innerText,
                                'List': cells[4].innerText,
                                'Score': cells[5].innerText
                            });
                        }
                    });
                    return data;
                });
                resultsCount = results.length;
            } catch (e) {
                console.log("No se encontraron elementos.");
            }
            break;
    }
    
    await browser.close();

    return {
        hits: resultsCount,
        elementos: results.length > 0 ? results : 'No hay hits',
    }; 
}
