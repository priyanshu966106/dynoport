/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Command } from 'commander';
// eslint-disable-next-line node/no-extraneous-import
import AWS from 'aws-sdk';
import fs from 'fs';
import readline from 'readline';
import * as ndjson from 'ndjson';
import { log } from 'console';
import loChunk from 'lodash/chunk';
import * as bluebird from 'bluebird';

const packageJson = require('../package.json');
const version: string = packageJson.version;

const program = new Command();

program
  .version('1.0.0')
  .name('my-command')
  .requiredOption('-t, --table <tableName>', 'DynamoDB table name')
  .requiredOption('-f, --filePath <filePath>', 'Output JSON file path')
  .option('-r, --region <region>', 'Aws region to use')
  .option(
    '-m, --mode <mode>',
    'Export or Import mode [export|import]',
    'export'
  )
  .parse(process.argv);

async function exportTableToJson(
  tableName: string,
  outputFilePath: string,
  region: string
) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  const dynamodb = new AWS.DynamoDB.DocumentClient({ region });

  const scanParams: AWS.DynamoDB.DocumentClient.ScanInput = {
    TableName: tableName,
  };

  let totalCount = 0;
  const outputStream = fs.createWriteStream(outputFilePath, { flags: 'a' });
  try {
    do {
      const scanResult = await dynamodb.scan(scanParams).promise();
      scanParams.ExclusiveStartKey = scanResult.LastEvaluatedKey;
      // eslint-disable-next-line @typescript-eslint/restrict-plus-operands, @typescript-eslint/no-unsafe-call

      // eslint-disable-next-line @typescript-eslint/restrict-plus-operands, @typescript-eslint/no-unsafe-call

      scanResult.Items &&
        scanResult.Items.forEach(item => {
          const timestampedObj = {
            ...item,
          };
          const jsonString = JSON.stringify(timestampedObj);
          outputStream.write(jsonString + '\n');
        });

      totalCount += scanResult.Count || 0;

      console.log(`[${new Date().toISOString()}] Scanned ${totalCount}`);
    } while (scanParams.ExclusiveStartKey);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call

    console.log(
      `Table '${tableName}' exported to '${outputFilePath}' successfully.`
    );
  } catch (error) {
    console.error('Error exporting DynamoDB table:', error);
  }
}

interface Item {
  [key: string]: any;
}

// eslint-disable-next-line @typescript-eslint/require-await
async function importJsonToTable(
  tableName: string,
  filePath: string,
  region: string
) {
  // Create an AWS DynamoDB client
  const dynamoDB = new AWS.DynamoDB.DocumentClient({ region });

  // Read the NDJSON file
  const fileStream = fs.createReadStream(filePath);

  // Parse the NDJSON data
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  const parser = ndjson.parse();

  // Chunk size for parallel requests
  const chunkSize = 25; // Adjust this as needed

  // Array to hold batch write requests
  const writeRequests: AWS.DynamoDB.DocumentClient.WriteRequest[] = [];

  let itemCount = 0;

  // Function to execute batch write requests

  // Event handler for each parsed item
  // eslint-disable-next-line @typescript-eslint/no-misused-promises, @typescript-eslint/require-await
  parser.on('data', async (item: Item) => {
    itemCount++;
    // Create a new batch write request for each item
    writeRequests.push({
      PutRequest: {
        Item: item,
      },
    });

    // If the batch write requests reach the chunk size, execute them
  });

  // Event handler for the end of the file
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  parser.on('end', async () => {
    // Execute any remaining batch write requests
    let batch = 0;
    console.log(`Total records writing with length ${itemCount}`);
    try {
      for await (const chunkedWriteRequest of loChunk(writeRequests, 500)) {
        console.log(`On bactch ${batch} of ${chunkedWriteRequest.length}`);
        const writeRequestsPrime = loChunk(chunkedWriteRequest, 25);
        const totalBatches = writeRequestsPrime.length;
        let processedBtach = 0;
        await bluebird.Promise.map(
          writeRequestsPrime,
          (writeRequestPrime: any) => {
            console.log(`Write Requests ${processedBtach} of ${totalBatches}`);
            const params: AWS.DynamoDB.DocumentClient.BatchWriteItemInput = {
              RequestItems: {
                [tableName]: writeRequestPrime,
              },
            };
            processedBtach += 1;
            return dynamoDB.batchWrite(params).promise();
          },
          { concurrency: 5 }
        );
        batch = batch + 1;
        await bluebird.Promise.resolve();
      }
      console.log('Push Ended');
    } catch (err) {
      console.log(`Bulk write failed ${err}`);
    }
  });
  console.log(`Push started`);
  // Pipe the file stream through the NDJSON parser
  fileStream.pipe(parser);
}

const { table, filePath, mode, region } = program.opts();

if (!table || !filePath) {
  console.error('Please provide the required options.');
  program.help();
} else {
  if (mode === 'export') {
    // Export mode
    console.log('Export mode selected.');
    // Call the exportTableToJson function here
    void exportTableToJson(table, filePath, region);
  } else if (mode === 'import') {
    // Import mode
    console.log('Import mode selected.');
    void importJsonToTable(table, filePath, region);
  } else {
    console.error('Invalid mode. Please select either "export" or "import".');
    program.help();
  }
}
// Function code for CLI goes here
