import { ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { GLOBAL_VALIDATION_OPTIONS } from '../../config/app-validation';
import { ConversationFlowDto } from './operator-auth.controller';

describe('ConversationFlowDto', () => {
  it('accepts a custom flow with consecutive interactive option blocks', async () => {
    const pipe = new ValidationPipe(GLOBAL_VALIDATION_OPTIONS);
    const value = await pipe.transform(
      {
        name: 'Avaliação personalizada',
        description: '',
        active: true,
        kind: 'regular',
        steps: [
          {
            id: randomUUID(),
            type: 'poll',
            question: 'Quem realizou seu atendimento?',
            options: ['Wesley', 'Gabryel'],
            allowMultipleAnswers: false,
            delaySeconds: 0,
          },
          {
            id: randomUUID(),
            type: 'poll',
            question: 'Selecione uma nota',
            options: ['⭐', '⭐⭐'],
            allowMultipleAnswers: false,
            delaySeconds: 0,
          },
        ],
        pollOptions: [],
      },
      { type: 'body', metatype: ConversationFlowDto },
    );

    expect(value.steps).toHaveLength(2);
  });
});
