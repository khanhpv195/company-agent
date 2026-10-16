import type { TodoPriority } from '../enums';
import type { PaginationQuery } from './pagination.interface';

export interface Todo {
  id: string;
  title: string;
  description: string | null;
  completed: boolean;
  priority: TodoPriority;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTodoInput {
  title: string;
  description?: string;
  priority?: TodoPriority;
  completed?: boolean;
}

export type UpdateTodoInput = Partial<CreateTodoInput>;

export interface TodoQuery extends PaginationQuery {
  search?: string;
  completed?: boolean;
  priority?: TodoPriority;
}
