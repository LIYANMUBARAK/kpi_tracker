import { Request, Response } from 'express'
import path from 'path';
import axios from 'axios';
import mysql from 'mysql2/promise';
import pool from '../shared/dbConnectionPool';



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
        console.log(req.body)
        const { locationId, accessCode } = req.body;
        const connection = await pool.getConnection();


            const [rows]: any[] = await connection.execute(
                'SELECT COUNT(*) AS count FROM api_keys_data WHERE ghl_location_id = ?',
                [locationId]
            );
            
            const count = rows[0].count;
            // if(count>0){
            //     const validAccessToken = await fetchAuthTokenForLocation(locationId);

            //     // If the above function doesn't throw an error, we have a valid access token
            //     console.log(`Valid access token for location ${locationId}: ${validAccessToken}`);
        
            // }else{


        const encodedParams = new URLSearchParams();
encodedParams.set('client_id', process.env.CLIENT_ID as string); // Replace with your client_id
encodedParams.set('client_secret', process.env.CLIENT_SECRET as string); // Replace with your client_secret
encodedParams.set('grant_type', 'authorization_code'); // Or another grant type as needed
encodedParams.set('code', accessCode); // Replace with the authorization code
encodedParams.set('redirect_uri', "http://localhost:3000/capturecode/"); // Replace with the redirect URI used during authorization

const options = {
  method: 'POST',
  url: 'https://services.leadconnectorhq.com/oauth/token',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json'
  },
  data: encodedParams.toString(), // Convert to string
};


    const { data } = await axios.request(options);
    console.log(data);
  console.log(data.refresh_token.length)
   // Establish a connection to the database
 

  // Define the SQL query to insert data
  const sql = `
    INSERT INTO api_keys_data (ghl_location_id, ghl_oauth_token, ghl_refresh_token, ghl_oauth_token_expires_on)
    VALUES (?, ?, ?, ?);
  `;
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const ghlTokenExpirationTime = currentTimestamp + data.expires_in;

  if (count > 0) {
    // Update the existing record
    const updateSql = `
        UPDATE api_keys_data
        SET ghl_oauth_token = ?, ghl_refresh_token = ?, ghl_oauth_token_expires_on = ?
        WHERE ghl_location_id = ?;
    `;
    const updateValues = [
        data.access_token,
        data.refresh_token,
        ghlTokenExpirationTime,
        locationId
    ];

    await connection.execute(updateSql, updateValues);
    res.send(`Data updated successfully for Location ID: ${locationId}`);
} else {
    // Insert a new record
    const insertSql = `
        INSERT INTO api_keys_data (ghl_location_id, ghl_oauth_token, ghl_refresh_token, ghl_oauth_token_expires_on)
        VALUES (?, ?, ?, ?);
    `;
    const insertValues = [
        locationId,
        data.access_token,
        data.refresh_token,
        ghlTokenExpirationTime
    ];

    await connection.execute(insertSql, insertValues);
    res.send(`Data inserted successfully for Location ID: ${locationId}`);
}

// Close the connection
connection.release();
  

       
       
    // }
    } catch (error) {
        console.log("Error:",error)
    }
  }



  async function fetchAuthTokenForLocation(locationId: string): Promise<string> {
    const connection = await pool.getConnection();

    try {
        const [rows]: any[] = await connection.execute(
            'SELECT ghl_oauth_token, ghl_refresh_token, ghl_oauth_token_expires_on FROM api_keys_data WHERE ghl_location_id = ?',
            [locationId]
        );

        if (rows.length === 0) {
            throw new Error(`No token found for locationId: ${locationId}`);
        }

        const { ghl_oauth_token, ghl_refresh_token, ghl_oauth_token_expires_on } = rows[0];
        const currentTimestamp = Math.floor(Date.now() / 1000);

        if (ghl_oauth_token_expires_on > currentTimestamp) {
            console.log('Token is still valid. Returning existing token.');
            return ghl_oauth_token;
        }

        console.log('Token has expired. Refreshing token...');
        const encodedParams = new URLSearchParams();
        encodedParams.set('client_id', process.env.CLIENT_ID as string);
        encodedParams.set('client_secret', process.env.CLIENT_SECRET as string);
        encodedParams.set('grant_type', 'refresh_token');
        encodedParams.set('refresh_token', ghl_refresh_token);

        const options = {
            method: 'POST',
            url: 'https://services.leadconnectorhq.com/oauth/token',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json'
            },
            data: encodedParams.toString(),
        };

        const { data } = await axios.request(options);
        const newExpirationTime = currentTimestamp + data.expires_in;

        await connection.execute(
            'UPDATE api_keys_data SET ghl_oauth_token = ?, ghl_refresh_token = ?, ghl_oauth_token_expires_on = ? WHERE ghl_location_id = ?',
            [data.access_token, data.refresh_token, newExpirationTime, locationId]
        );

        console.log('Token refreshed and updated in the database.');
        return data.access_token;

    } catch (error) {
        console.error('Error fetching or refreshing the token:', error);
        throw error;
    } finally {
        connection.release();  // Release the connection back to the pool
    }
}


export async function handleContactData(req: Request, res: Response) {
    const { type, locationId, contactId } = req.body;
    
    try {
      const connection = await pool.getConnection();
    
      if (type === 'ContactDelete') {
        // Delete contact from database
        await connection.execute(
          'DELETE FROM ghl_contacts WHERE ghl_contact_id = ?',
          [contactId]
        );
        res.send(`Contact with ID ${contactId} deleted successfully.`);
      } else if (type === 'ContactCreate') {
        // Fetch contact details from GHL API
        const options = {
          method: 'GET',
          url: `https://services.leadconnectorhq.com/contacts/${contactId}`,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${await fetchAuthTokenForLocation(locationId)}`, // Function to fetch or refresh token,
            'Version':'2021-07-28'
          },
        };
  
        const { data } = await axios.request(options);
console.log(JSON.stringify(data, null, 2)); // Converts object to a nicely formatted JSON string
        // // Prepare data for insertion/update
        // const { firstName, lastName, email, phone, tags, customField1, customFieldN, createdOn, updatedOn } = data;
  
       
           // Prepare data for insertion/update
           const { firstName, lastName, email, phone, tags, customFields, dateAdded, dateUpdated } = data.contact;

           // Convert dates to MySQL-compatible format
           const formattedDateAdded = dateAdded ? formatDateForMySQL(dateAdded) : null;
           const formattedDateUpdated = dateUpdated ? formatDateForMySQL(dateUpdated) : null;

           // Prepare custom fields
           const customFieldsData: { [key: string]: any } = {};
           customFields.forEach((field: { id: string; value: any }, index: number) => {
               if (index < 5) {
                   customFieldsData[`customfield${index + 1}`] = field.value || null;
               }
           });

           // Fill missing custom fields
           const customFieldValues = [
               customFieldsData.customfield1 || null,
               customFieldsData.customfield2 || null,
               customFieldsData.customfield3 || null,
               customFieldsData.customfield4 || null,
               customFieldsData.customfield5 || null,
           ];

           const sql = `
               INSERT INTO ghl_contacts (ghl_location_id, ghl_contact_id, fname, lname, email, phone, tags_list, customfield1, customfield2, customfield3, customfield4, customfield5, dateAdded, dateUpdated)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE
                   fname = VALUES(fname),
                   lname = VALUES(lname),
                   email = VALUES(email),
                   phone = VALUES(phone),
                   tags_list = VALUES(tags_list),
                   customfield1 = VALUES(customfield1),
                   customfield2 = VALUES(customfield2),
                   customfield3 = VALUES(customfield3),
                   customfield4 = VALUES(customfield4),
                   customfield5 = VALUES(customfield5),
                   dateAdded = VALUES(dateAdded),
                   dateUpdated = VALUES(dateUpdated),
                   updated_on = VALUES(updated_on);
           `;
 
           const values = [
               locationId,
               contactId,
               firstName,
               lastName,
               email,
               phone,
               JSON.stringify(tags),  // Assuming tags is an array
               ...customFieldValues,
               formattedDateAdded,
               formattedDateUpdated,
           ];

           await connection.execute(sql, values);
           res.send(`Contact with ID ${contactId} inserted/updated successfully.`);
       } else {
           res.status(400).send('Invalid type');
       }
   } catch (error) {
       console.error('Error handling contact data:', error);
       res.status(500).send('Internal Server Error');
   }
}
function formatDateForMySQL(dateString: string): string {
    const date = new Date(dateString);
    const year = date.getFullYear();
    const month = ('0' + (date.getMonth() + 1)).slice(-2);
    const day = ('0' + date.getDate()).slice(-2);
    const hours = ('0' + date.getHours()).slice(-2);
    const minutes = ('0' + date.getMinutes()).slice(-2);
    const seconds = ('0' + date.getSeconds()).slice(-2);
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}
