import { Body, Controller, Get, Headers, Put } from '@nestjs/common';
import { Public } from '../auth/decorators/auth.decorators';
import { RobotAutomationService } from './robot-automation.service';

@Public()
@Controller('operator-auth/admin/robot')
export class RobotAutomationController {
  constructor(private readonly robot: RobotAutomationService) {}

  @Get()
  get(@Headers('x-atende-token') token = '') { return this.robot.get(token); }

  @Put()
  save(@Headers('x-atende-token') token = '', @Body() body: unknown) { return this.robot.save(token, body); }
}
