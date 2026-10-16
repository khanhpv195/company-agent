import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SortOrder, TodoPriority } from '@repo/shared';
import { ILike, Repository } from 'typeorm';
import { PaginatedResult } from '../../common/dto';
import { QueryTodoDto } from './dto/query-todo.dto';
import { Todo } from './entities/todo.entity';
import { TodosService } from './todos.service';

type RepositoryMock = jest.Mocked<
  Pick<Repository<Todo>, 'create' | 'save' | 'findAndCount' | 'findOneBy' | 'merge' | 'remove'>
>;

const buildTodo = (overrides: Partial<Todo> = {}): Todo => ({
  id: '0b7f2a8e-6a3c-4c39-9a6e-0d1d1f0b5a11',
  title: 'Write tests',
  description: null,
  completed: false,
  priority: TodoPriority.MEDIUM,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

const buildQuery = (overrides: Partial<QueryTodoDto> = {}): QueryTodoDto =>
  Object.assign(new QueryTodoDto(), overrides);

describe('TodosService', () => {
  let service: TodosService;
  let repository: RepositoryMock;

  beforeEach(async () => {
    repository = {
      create: jest.fn(),
      save: jest.fn(),
      findAndCount: jest.fn(),
      findOneBy: jest.fn(),
      merge: jest.fn(),
      remove: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [TodosService, { provide: getRepositoryToken(Todo), useValue: repository }],
    }).compile();

    service = moduleRef.get(TodosService);
  });

  describe('create', () => {
    it('creates and saves a todo', async () => {
      const todo = buildTodo({ title: 'New' });
      repository.create.mockReturnValue(todo);
      repository.save.mockResolvedValue(todo);

      await expect(service.create({ title: 'New' })).resolves.toBe(todo);
      expect(repository.create).toHaveBeenCalledWith({ title: 'New' });
      expect(repository.save).toHaveBeenCalledWith(todo);
    });
  });

  describe('findAll', () => {
    it('returns a paginated result with default pagination', async () => {
      const todos = [buildTodo()];
      repository.findAndCount.mockResolvedValue([todos, 21]);

      const result = await service.findAll(buildQuery());

      expect(repository.findAndCount).toHaveBeenCalledWith({
        where: {},
        order: { createdAt: SortOrder.DESC },
        skip: 0,
        take: 10,
      });
      expect(result).toBeInstanceOf(PaginatedResult);
      expect(result.items).toBe(todos);
      expect(result.meta).toEqual({ page: 1, limit: 10, total: 21, totalPages: 3 });
    });

    it('applies filters, sorting and offset', async () => {
      repository.findAndCount.mockResolvedValue([[], 0]);

      await service.findAll(
        buildQuery({
          page: 3,
          limit: 5,
          order: SortOrder.ASC,
          search: '50%_off',
          completed: true,
          priority: TodoPriority.HIGH,
        }),
      );

      expect(repository.findAndCount).toHaveBeenCalledWith({
        where: {
          title: ILike('%50\\%\\_off%'),
          completed: true,
          priority: TodoPriority.HIGH,
        },
        order: { createdAt: SortOrder.ASC },
        skip: 10,
        take: 5,
      });
    });
  });

  describe('findOne', () => {
    it('returns the todo when it exists', async () => {
      const todo = buildTodo();
      repository.findOneBy.mockResolvedValue(todo);

      await expect(service.findOne(todo.id)).resolves.toBe(todo);
      expect(repository.findOneBy).toHaveBeenCalledWith({ id: todo.id });
    });

    it('throws NotFoundException with an i18n key when missing', async () => {
      repository.findOneBy.mockResolvedValue(null);

      const error = await service.findOne('missing').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toEqual({
        message: 'todos.NOT_FOUND',
        args: { id: 'missing' },
      });
    });
  });

  describe('update', () => {
    it('merges changes and saves', async () => {
      const todo = buildTodo();
      repository.findOneBy.mockResolvedValue(todo);
      repository.save.mockImplementation(async (entity) => entity as Todo);

      await service.update(todo.id, { completed: true });

      expect(repository.merge).toHaveBeenCalledWith(todo, { completed: true });
      expect(repository.save).toHaveBeenCalledWith(todo);
    });

    it('throws when the todo does not exist', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(service.update('missing', { completed: true })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repository.save).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('removes an existing todo', async () => {
      const todo = buildTodo();
      repository.findOneBy.mockResolvedValue(todo);

      await service.remove(todo.id);

      expect(repository.remove).toHaveBeenCalledWith(todo);
    });

    it('throws when the todo does not exist', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(service.remove('missing')).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.remove).not.toHaveBeenCalled();
    });
  });
});
