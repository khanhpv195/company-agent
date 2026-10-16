import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';
import { PaginatedResult } from '../../common/dto';
import { escapeLikePattern } from '../../common/utils';
import { CreateTodoDto } from './dto/create-todo.dto';
import { QueryTodoDto } from './dto/query-todo.dto';
import { UpdateTodoDto } from './dto/update-todo.dto';
import { Todo } from './entities/todo.entity';

@Injectable()
export class TodosService {
  constructor(
    @InjectRepository(Todo)
    private readonly todosRepository: Repository<Todo>,
  ) {}

  create(dto: CreateTodoDto): Promise<Todo> {
    const todo = this.todosRepository.create(dto);
    return this.todosRepository.save(todo);
  }

  async findAll(query: QueryTodoDto): Promise<PaginatedResult<Todo>> {
    const { page, limit, order, search, completed, priority } = query;

    const where: FindOptionsWhere<Todo> = {};
    if (search) where.title = ILike(`%${escapeLikePattern(search)}%`);
    if (completed !== undefined) where.completed = completed;
    if (priority) where.priority = priority;

    const [items, total] = await this.todosRepository.findAndCount({
      where,
      order: { createdAt: order },
      skip: (page - 1) * limit,
      take: limit,
    });

    return PaginatedResult.of(items, total, page, limit);
  }

  async findOne(id: string): Promise<Todo> {
    const todo = await this.todosRepository.findOneBy({ id });
    if (!todo) {
      throw new NotFoundException({ message: 'todos.NOT_FOUND', args: { id } });
    }
    return todo;
  }

  async update(id: string, dto: UpdateTodoDto): Promise<Todo> {
    const todo = await this.findOne(id);
    this.todosRepository.merge(todo, dto);
    return this.todosRepository.save(todo);
  }

  async remove(id: string): Promise<void> {
    const todo = await this.findOne(id);
    await this.todosRepository.remove(todo);
  }
}
