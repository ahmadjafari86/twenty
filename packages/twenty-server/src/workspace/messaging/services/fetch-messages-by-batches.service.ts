import { Injectable, Logger } from '@nestjs/common';

import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { simpleParser, AddressObject } from 'mailparser';
import planer from 'planer';

import {
  GmailMessage,
  Participant,
} from 'src/workspace/messaging/types/gmail-message';
import { MessageQuery } from 'src/workspace/messaging/types/message-or-thread-query';
import { GmailMessageParsedResponse } from 'src/workspace/messaging/types/gmail-message-parsed-response';

@Injectable()
export class FetchMessagesByBatchesService {
  private readonly httpService: AxiosInstance;
  private readonly logger = new Logger(FetchMessagesByBatchesService.name);

  constructor() {
    this.httpService = axios.create({
      baseURL: 'https://www.googleapis.com/batch/gmail/v1',
    });
  }

  async fetchAllMessages(
    queries: MessageQuery[],
    accessToken: string,
    jobName?: string,
    workspaceId?: string,
    connectedAccountId?: string,
  ): Promise<{ messages: GmailMessage[]; errors: any[] }> {
    let startTime = Date.now();
    const batchResponses = await this.fetchAllByBatches(
      queries,
      accessToken,
      'batch_gmail_messages',
    );
    let endTime = Date.now();

    this.logger.log(
      `${jobName} for workspace ${workspaceId} and account ${connectedAccountId} fetching ${
        queries.length
      } messages in ${endTime - startTime}ms`,
    );

    startTime = Date.now();

    const formattedResponse =
      await this.formatBatchResponsesAsGmailMessages(batchResponses);

    endTime = Date.now();

    this.logger.log(
      `${jobName} for workspace ${workspaceId} and account ${connectedAccountId} formatting ${
        queries.length
      } messages in ${endTime - startTime}ms`,
    );

    return formattedResponse;
  }

  async fetchAllByBatches(
    queries: MessageQuery[],
    accessToken: string,
    boundary: string,
  ): Promise<AxiosResponse<any, any>[]> {
    const batchLimit = 50;

    let batchOffset = 0;

    let batchResponses: AxiosResponse<any, any>[] = [];

    while (batchOffset < queries.length) {
      const batchResponse = await this.fetchBatch(
        queries,
        accessToken,
        batchOffset,
        batchLimit,
        boundary,
      );

      batchResponses = batchResponses.concat(batchResponse);

      batchOffset += batchLimit;
    }

    return batchResponses;
  }

  async fetchBatch(
    queries: MessageQuery[],
    accessToken: string,
    batchOffset: number,
    batchLimit: number,
    boundary: string,
  ): Promise<AxiosResponse<any, any>> {
    const limitedQueries = queries.slice(batchOffset, batchOffset + batchLimit);

    const response = await this.httpService.post(
      '/',
      this.createBatchBody(limitedQueries, boundary),
      {
        headers: {
          'Content-Type': 'multipart/mixed; boundary=' + boundary,
          Authorization: 'Bearer ' + accessToken,
        },
      },
    );

    return response;
  }

  createBatchBody(queries: MessageQuery[], boundary: string): string {
    let batchBody: string[] = [];

    queries.forEach(function (call) {
      const method = 'GET';
      const uri = call.uri;

      batchBody = batchBody.concat([
        '--',
        boundary,
        '\r\n',
        'Content-Type: application/http',
        '\r\n\r\n',

        method,
        ' ',
        uri,
        '\r\n\r\n',
      ]);
    });

    return batchBody.concat(['--', boundary, '--']).join('');
  }

  parseBatch(
    responseCollection: AxiosResponse<any, any>,
  ): GmailMessageParsedResponse[] {
    const responseItems: GmailMessageParsedResponse[] = [];

    const boundary = this.getBatchSeparator(responseCollection);

    const responseLines: string[] = responseCollection.data.split(
      '--' + boundary,
    );

    responseLines.forEach(function (response) {
      const startJson = response.indexOf('{');
      const endJson = response.lastIndexOf('}');

      if (startJson < 0 || endJson < 0) return;

      const responseJson = response.substring(startJson, endJson + 1);

      const item = JSON.parse(responseJson);

      responseItems.push(item);
    });

    return responseItems;
  }

  getBatchSeparator(responseCollection: AxiosResponse<any, any>): string {
    const headers = responseCollection.headers;

    const contentType: string = headers['content-type'];

    if (!contentType) return '';

    const components = contentType.split('; ');

    const boundary = components.find((item) => item.startsWith('boundary='));

    return boundary?.replace('boundary=', '').trim() || '';
  }

  async formatBatchResponseAsGmailMessage(
    responseCollection: AxiosResponse<any, any>,
  ): Promise<{ messages: GmailMessage[]; errors: any[] }> {
    const parsedResponses = this.parseBatch(
      responseCollection,
    ) as GmailMessageParsedResponse[];

    const errors: any = [];

    const formattedResponse = Promise.all(
      parsedResponses.map(async (message: GmailMessageParsedResponse) => {
        if (message.error) {
          errors.push(message.error);

          return;
        }

        const { historyId, id, threadId, internalDate, raw } = message;

        const body = atob(raw?.replace(/-/g, '+').replace(/_/g, '/'));

        try {
          const parsed = await simpleParser(body, {
            skipHtmlToText: true,
            skipImageLinks: true,
            skipTextToHtml: true,
            maxHtmlLengthToParse: 0,
          });

          const { subject, messageId, from, to, cc, bcc, text, attachments } =
            parsed;

          if (!from) throw new Error('From value is missing');

          const participants = [
            ...this.formatAddressObjectAsParticipants(from, 'from'),
            ...this.formatAddressObjectAsParticipants(to, 'to'),
            ...this.formatAddressObjectAsParticipants(cc, 'cc'),
            ...this.formatAddressObjectAsParticipants(bcc, 'bcc'),
          ];

          let textWithoutReplyQuotations = text;

          if (text)
            try {
              textWithoutReplyQuotations = planer.extractFrom(
                text,
                'text/plain',
              );
            } catch (error) {
              console.log(
                'Error while trying to remove reply quotations',
                error,
              );
            }

          const messageFromGmail: GmailMessage = {
            historyId,
            externalId: id,
            headerMessageId: messageId || '',
            subject: subject || '',
            messageThreadExternalId: threadId,
            internalDate,
            fromHandle: from.value[0].address || '',
            fromDisplayName: from.value[0].name || '',
            participants,
            text: textWithoutReplyQuotations || '',
            attachments,
          };

          return messageFromGmail;
        } catch (error) {
          console.log('Error', error);

          errors.push(error);
        }
      }),
    );

    const filteredMessages = (await formattedResponse).filter(
      (message) => message,
    ) as GmailMessage[];

    return { messages: filteredMessages, errors };
  }

  formatAddressObjectAsArray(
    addressObject: AddressObject | AddressObject[],
  ): AddressObject[] {
    return Array.isArray(addressObject) ? addressObject : [addressObject];
  }

  formatAddressObjectAsParticipants(
    addressObject: AddressObject | AddressObject[] | undefined,
    role: 'from' | 'to' | 'cc' | 'bcc',
  ): Participant[] {
    if (!addressObject) return [];
    const addressObjects = this.formatAddressObjectAsArray(addressObject);

    const participants = addressObjects.map((addressObject) => {
      const emailAdresses = addressObject.value;

      return emailAdresses.map((emailAddress) => {
        const { name, address } = emailAddress;

        return {
          role,
          handle: address?.toLowerCase() || '',
          displayName: name || '',
        };
      });
    });

    return participants.flat();
  }

  async formatBatchResponsesAsGmailMessages(
    batchResponses: AxiosResponse<any, any>[],
  ): Promise<{ messages: GmailMessage[]; errors: any[] }> {
    const messagesAndErrors = await Promise.all(
      batchResponses.map(async (response) => {
        return this.formatBatchResponseAsGmailMessage(response);
      }),
    );

    const messages = messagesAndErrors.map((item) => item.messages).flat();

    const errors = messagesAndErrors.map((item) => item.errors).flat();

    return { messages, errors };
  }
}
