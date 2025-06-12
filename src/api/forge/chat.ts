const router: Router = express.Router();
import express, { Request, Response, Router } from 'express';
import { successResponse } from '../../middleware/types/errors.ts';
import { validateBody } from '../../middleware/validator.ts';
import { chatRequestSchema } from '../schemas/forge.ts';
import { errorHandlerAsync } from '../../middleware/errorHandler.ts';
import { AppInfo } from '../../types/index.ts';
import { SYSTEM_PROMPT, TASK_SHOT_EXAMPLES } from '../../services/forge/index.ts';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
}

interface ChatBody {
  messages: Message[];
  task_prompt: string;
  app: AppInfo;
}

// Sample few-shot conversation history
// Add route to router
router.post(
  '/',
  validateBody(chatRequestSchema),
  errorHandlerAsync(async (req: Request<{}, {}, ChatBody>, res: Response) => {
    const { messages, task_prompt, app } = req.body;

    // Format context message
    const contextMessage = `Task: ${task_prompt}\nApp: ${app.name} (${app.type}${
      app.type === 'executable' ? `, Path: ${app.path}` : `, URL: ${app.url}`
    })`;

    // Randomly select 3 few-shot examples
    const randomExamples = [...TASK_SHOT_EXAMPLES].sort(() => Math.random() - 0.5).slice(0, 3);

    // Prepare messages for OpenAI API
    const apiMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      // Include all three random examples
      ...randomExamples.flatMap((example) => example.conversation),
      { role: 'user', content: contextMessage },
      ...messages
    ];

    // Call OpenAI API
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: apiMessages,
      tools: [
        {
          type: 'function',
          function: {
            name: 'validate_task_request',
            description:
              "Validate if the user's task request is appropriate and can be assisted with",
            parameters: {
              type: 'object',
              required: ['title', 'app', 'objectives', 'content'],
              properties: {
                title: {
                  type: 'string',
                  description: 'Brief title for the task'
                },
                app: {
                  type: 'string',
                  description: 'Name of the app being used'
                },
                icon_url: {
                  type: 'string',
                  description: "URL for the app's favicon"
                },
                objectives: {
                  type: 'array',
                  description:
                    'List of 4 objectives to complete the task (first objective must be opening/navigating to the app with the app name wrapped in <app> tags, stop at checkout for purchases)',
                  items: {
                    type: 'string'
                  }
                },
                content: {
                  type: 'string',
                  description: "The assistant's message to the user"
                }
              }
            }
          }
        }
      ]
    } as any);

    const assistantMessage = response.choices[0].message;

    // Handle tool calls if present
    if (assistantMessage.tool_calls?.length) {
      const toolCall = assistantMessage.tool_calls[0];
      // Add tool call to response
      res.status(200).json(
        successResponse({
          role: 'assistant',
          content: assistantMessage.content,
          tool_calls: [
            {
              id: toolCall.id,
              type: 'function',
              function: {
                name: toolCall.function.name,
                arguments: toolCall.function.arguments
              }
            }
          ]
        })
      );
    } else {
      // Return regular message
      res.status(200).json(
        successResponse({
          role: 'assistant',
          content: assistantMessage.content
        })
      );
    }
  })
);

export { router as forgeChatApi };
