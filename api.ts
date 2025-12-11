/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
/* tslint:disable */

import {FunctionDeclaration, GoogleGenAI, Type} from '@google/genai';

const systemInstruction = `When given a video and a query, call the relevant \
function only once with the appropriate timecodes and text for the video`;

const client = new GoogleGenAI({apiKey: process.env.API_KEY});

// FIX: Replaced incorrect `Type.Blob` with `any` for the Gemini file object parameter.
// The `Type` enum from `@google/genai` is for schema definitions and does not
// contain a `Blob` type.
async function generateContent(
  text: string,
  functionDeclarations: FunctionDeclaration[] | null,
  file: any,
) {
  const config: any = {
    temperature: 0.5,
  };

  if (functionDeclarations) {
    config.systemInstruction = systemInstruction;
    config.tools = [{functionDeclarations}];
  }

  const response = await client.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: {
      parts: [
        {text},
        {
          fileData: {
            mimeType: file.mimeType,
            fileUri: file.uri,
          },
        },
      ],
    },
    config,
  });

  return response;
}

async function uploadFile(file: File) {
  const blob = new Blob([file], {type: file.type});

  console.log('Загрузка...');
  const uploadedFile = await client.files.upload({
    file: blob,
    config: {
      displayName: file.name,
    },
  });
  console.log('Загружено.');
  console.log('Получение...');
  let getFile = await client.files.get({
    name: uploadedFile.name,
  });
  while (getFile.state === 'PROCESSING') {
    getFile = await client.files.get({
      name: uploadedFile.name,
    });
    console.log(`текущий статус файла: ${getFile.state}`);
    console.log('Файл все еще обрабатывается, повторная попытка через 5 секунд');

    await new Promise((resolve) => {
      setTimeout(resolve, 5000);
    });
  }
  console.log(getFile.state);
  if (getFile.state === 'FAILED') {
    throw new Error('Ошибка обработки файла.');
  }
  console.log('Готово');
  return getFile;
}

export {generateContent, uploadFile};