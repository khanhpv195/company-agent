import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse, ApiWrappedResponse, ResponseMessage } from '../../common/decorators';
import { PaginatedResult } from '../../common/dto';
import { CreateTodoDto } from './dto/create-todo.dto';
import { QueryTodoDto } from './dto/query-todo.dto';
import { UpdateTodoDto } from './dto/update-todo.dto';
import { Todo } from './entities/todo.entity';
import { TodosService } from './todos.service';

@ApiTags('todos')
@Controller('todos')
export class TodosController {
  constructor(private readonly todosService: TodosService) {}

  @Post()
  @ApiOperation({ summary: 'Create a todo' })
  @ApiWrappedResponse(Todo, HttpStatus.CREATED)
  @ResponseMessage('todos.CREATED')
  create(@Body() dto: CreateTodoDto): Promise<Todo> {
    return this.todosService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List todos (paginated)' })
  @ApiPaginatedResponse(Todo)
  @ResponseMessage('todos.LIST')
  findAll(@Query() query: QueryTodoDto): Promise<PaginatedResult<Todo>> {
    return this.todosService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a todo by id' })
  @ApiWrappedResponse(Todo)
  @ResponseMessage('todos.DETAIL')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Todo> {
    return this.todosService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a todo' })
  @ApiWrappedResponse(Todo)
  @ResponseMessage('todos.UPDATED')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTodoDto): Promise<Todo> {
    return this.todosService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a todo' })
  @ApiWrappedResponse(null)
  @ResponseMessage('todos.DELETED')
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<null> {
    await this.todosService.remove(id);
    return null;
  }
}
