import { Request, Response } from 'express'
import path from 'path';
import 'dotenv/config';


export async function initiateAuth(req: Request, res: Response) {
    try {
      const authUrl = `https://marketplace.gohighlevel.com/oauth/chooselocation?response_type=code&redirect_uri=${process.env.REDIRECT_URL}&client_id=${process.env.CLIENT_ID}&scope=contacts.readonly locations.readonly users.readonly`;
      res.redirect(authUrl)  //get token from url params
    } catch (error) {
      console.log("Auth initiation failed.Error:" + error)
    }
  }

  export async function captureCode(req:Request,res:Response) {
    try {
        const code = req.query.code as string; // Get the code from the query parameters

        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                 <link href="https://dashboard.kashcallerai.com/static/css/bootstrap5.css" rel="stylesheet">
    <link href="https://dashboard.kashcallerai.com/static/css/select2.min.css" rel="stylesheet">
                <title>Access Code</title>
            </head>
            <body>
            <div class="text-center mt-5">
                <h1>Access Code</h1>
                <p id="code" class="text-muted">${code}</p>
                <button id="copyButton" class="btn btn-success mt-3">Copy Code</button>
                </div>
                <script>
                    document.getElementById('copyButton').addEventListener('click', () => {
                        const code = document.getElementById('code').innerText;
                        navigator.clipboard.writeText(code).then(() => {
                            alert('Code copied to clipboard!');
                        }).catch(err => {
                            console.error('Failed to copy code: ', err);
                        });
                    });
                </script>
            </body>
            </html>
        `);



    } catch (error) {
        console.log("Error:",error)
    }
  }

  export async function getAccessToken(req:Request,res:Response) {
    try {
        // Serve the HTML form

    res.sendFile(path.join(__dirname, '../public', 'index.html'));



    } catch (error) {
        console.log("Error:",error)
    }
  }

  export async function formSubmission(req:Request,res:Response) {
    try {
        // Serve the HTML form

        const { locationId, accessToken } = req.body;
        res.send(`Location Id: ${locationId}, Access Token: ${accessToken}`);


    } catch (error) {
        console.log("Error:",error)
    }
  }
