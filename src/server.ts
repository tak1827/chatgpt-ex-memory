import express from 'express';
import multer from 'multer';
import axios from 'axios';
import bodyParser from 'body-parser';
import { Readable } from 'stream';
import path from 'path';

const app = express();
const PORT = 3000;
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const Endpoint = process.env.ENDPOINT || 'http://0.0.0.0:8000';
const bearerToken =
  process.env.BEARER_TOKEN ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

// Middleware to parse JSON requests
app.use(bodyParser.json());

app.get('/', (_, res) => {
  res.send('Hello, TypeScript!');
});

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (req.file === undefined) {
      throw new Error('File not provided');
    }
    const { originalname, buffer } = req.file as Express.Multer.File;
    const [author, rawUrl] = originalname.split('|');
    if (author === undefined || rawUrl === undefined) {
      throw new Error('File name format is invalid');
    }
    const url = rawUrl.replace('.txt', '');

    // Convert buffer to stream
    const stream = new Readable();
    stream.push(buffer);
    stream.push(null); // indicates the end of file

    // Read file content from the stream
    let fileContent = '';
    for await (const chunk of stream) {
      fileContent += chunk;
    }

    const formattedData = {
      documents: [
        {
          text: fileContent,
          metadata: {
            source: 'file',
            url,
            created_at: new Date().toISOString(),
            author,
          },
        },
      ],
    };
    console.log(formattedData.documents[0].metadata);
    await postToEndpoint(formattedData, res);
  } catch (err: any) {
    console.error('Error:', err.message);
    res.status(500).send({ message: 'Internal server error' });
  }
});

app.post('/uploads', upload.array('files'), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];

    const documents = [];

    const created_at = new Date().toISOString();

    for (const file of files) {
      const { originalname, buffer } = file;

      const [author, rawUrl] = originalname.split('|');
      const url = rawUrl.replace('.txt', '');

      // Convert buffer to stream
      const stream = new Readable();
      stream.push(buffer);
      stream.push(null); // indicates the end of file

      // Read file content from the stream
      let fileContent = '';
      for await (const chunk of stream) {
        fileContent += chunk;
      }

      const document = {
        text: fileContent,
        metadata: {
          source: 'file',
          url,
          created_at,
          author,
        },
      };

      documents.push(document);
    }

    const formattedData = { documents };
    await postToEndpoint(formattedData, res);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Define a route for the "query" API
app.post('/query', (req, res) => {
  // Extract query parameters from the request body
  const { query, tag, start_date, end_date, top_k } = req.body;

  // Prepare the request payload
  const requestPayload = {
    queries: [
      {
        query,
        filter: {
          author: tag || undefined, // Optional author/tag
          start_date: start_date || undefined, // Optional start_date as a string
          end_date: end_date || undefined, // Optional end_date as a string
        },
        top_k: top_k || 5, // Optional top_k with a default of 5
      },
    ],
  };

  // Make a POST request to the external API
  axios
    .post(`${Endpoint}/query`, requestPayload, {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
      },
    })
    .then((response) => {
      if (response.status === 200 && response.data.results) {
        // Handle success response
        const results = response.data.results[0].results;
        res.status(200).json({ results });
      } else {
        // Handle unexpected response format
        res
          .status(500)
          .json({ error: 'Unexpected response from external API' });
      }
    })
    .catch((error) => {
      if (error.response && error.response.data) {
        // Handle error response
        const { detail } = error.response.data;
        console.log(detail);
        res.status(400).json({ detail });
      } else {
        // Handle network or other errors
        res.status(500).json({ error: 'Internal server error' });
      }
    });
});

async function postToEndpoint(formattedData: any, res: any) {
  const response = await axios.post(`${Endpoint}/upsert`, formattedData, {
    headers: {
      Authorization: `Bearer ${bearerToken}`,
    },
  });
  const responseData = response.data;

  if (responseData.ids) {
    res.status(200).send({
      message: 'File processed and posted successfully',
      ids: responseData.ids,
    });
  } else if (responseData.detail) {
    console.log('Errors:');
    responseData.detail.forEach((error: any) => {
      console.log(
        `Location: ${error.loc.join(', ')}, Message: ${error.msg}, Type: ${
          error.type
        }`,
      );
    });
    res.status(400).send({
      message: 'Error processing file',
      errors: responseData.detail,
    });
  } else {
    throw new Error('Unknown response format from endpoint');
  }
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
