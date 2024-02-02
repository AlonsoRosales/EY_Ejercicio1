const express = require('express');
const app = express();
const cors = require('cors');
const puppeteer = require('puppeteer');
const jwt = require("jsonwebtoken");
const bodyParser = require("body-parser");
const rateLimit = require("express-rate-limit");

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));
app.listen(3000, function (){
    console.log("Servidor corriendo en el puerto 3000")
});

//  Credenciales permitidas
const USER = "EY";
const PASSWORD = "EY2024";

const apiLimiter = rateLimit({
    windowMs: 1*60*1000,
    max: 20,
    message:{
        success: false,
        message: "Demasiadas solicitudes desde esta IP, por favor intente de nuevo después de 1 minuto"
    }
})


//  Endpoint Login
app.post("/login", apiLimiter, (req, res) => {
    const { username, password } = req.body;
    if (username === USER && password === PASSWORD) {
        const token = jwt.sign({ username }, "EY", { expiresIn: '24h' }); 
        res.json({
            success: true,
            message: 'Autenticación correcta',
            token: token
        });
    } else {
        res.status(401).json({
            success: false,
            message: 'Usuario o contraseña incorrectos'
        });
    }
});

// Endpoint para verificar el token
app.get("/verify-token", apiLimiter, (req, res) => {
    const bearerHeader = req.headers['authorization'];
    
    if (typeof bearerHeader !== 'undefined') {
        jwt.verify(bearerHeader, "EY", (err, authData) => {
            if (err) {
                res.json({ success: false, message: 'Token no válido o expirado' });
            } else {
                res.json({ success: true, message: 'Token válido'});
            }
        });
    } else {
        res.status(401).json({ success: false, message: 'No se proporcionó token' });
    }
});

//  Endpoint para hacer web scrapping a una fuente
app.get("/search/:source/:entity", apiLimiter, verifyToken, async function(req, res){
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
        //slowMo: 500,
    });

    const page = await browser.newPage();   
    await page.goto(url);
    
    let results = [];
    let resultsCount = 0;
    let message = "No hay hits";

    switch(source){
        case '1':
            // Interactuamos con el checkbox y el botón de Submit
            await page.waitForSelector('input[type="checkbox"]');
            await page.click('input[type="checkbox"]'); 
            const submitButton = await page.$x("//button[contains(text(), 'Submit')]");
            await submitButton[0].click();

            //Escribimos en el campo de búsqueda y enviamos el form
            await page.type('input[name="q"]', entity);
            await page.waitForTimeout(1000);
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
                message = "Error durante la búsqueda de resultados";
            }
            break;

        case '2':
            //  Interactuamos con el campo de categoría y esperamos los resultados
            await page.waitForTimeout(6000);
            await page.type('#category', entity);
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
                message = message = "Error durante la búsqueda de resultados";
            }
            break;

        case '3':
            // Interactuamos con el input y el botón de búsqueda
            await page.type('#ctl00_MainContent_txtLastName', entity);
            await page.click('input[name="ctl00$MainContent$btnSearch"]');
           
            try {
                // Esperar a que los resultados de la búsqueda se carguen
                const hasResults = await page.waitForSelector('#gvSearchResults tr', { visible: true, timeout: 1000 })
                .then(() => true).catch(() => false);
                if (hasResults) {
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
                }
            } catch (e) {
                message = message = "Error durante la búsqueda de resultados";
            }
            break;
    }
    
    await browser.close();

    return {
        hits: resultsCount,
        elementos: results.length > 0 ? results : message,
    }; 
}

function verifyToken(req, res, next) {
    const bearerHeader = req.headers['authorization'];
    if (typeof bearerHeader !== 'undefined') {
        const bearerToken = bearerHeader
        jwt.verify(bearerToken, "EY", (err, authData) => {
            if (err) {
                return res.status(403).json({ success: false, message: 'Token no válido o expirado' });
            } else {
                req.authData = authData;
                next();
            }
        });
    } else {
        res.status(401).json({ success: false, message: 'Acceso no permitido. No se proporcionó token.' });
    }
}