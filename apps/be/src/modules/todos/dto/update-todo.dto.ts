import { PartialType } from '@nestjs/swagger';
import { UpdateTodoInput } from '@repo/shared';
import { CreateTodoDto } from './create-todo.dto';

export class UpdateTodoDto extends PartialType(CreateTodoDto) implements UpdateTodoInput {}
