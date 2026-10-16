import { TodoPriority } from '@repo/shared';
import { DataSource } from 'typeorm';
import { Todo } from '../../modules/todos/entities/todo.entity';

const SAMPLE_TODOS: Array<Pick<Todo, 'title' | 'priority' | 'completed'>> = [
  { title: 'Set up the monorepo', priority: TodoPriority.HIGH, completed: true },
  { title: 'Run the database migrations', priority: TodoPriority.HIGH, completed: true },
  { title: 'Open the Tauri desktop app', priority: TodoPriority.MEDIUM, completed: false },
  { title: 'Create a new Nest module', priority: TodoPriority.LOW, completed: false },
];

export const seedTodos = async (dataSource: DataSource): Promise<number> => {
  const repository = dataSource.getRepository(Todo);
  if ((await repository.count()) > 0) return 0;

  await repository.save(SAMPLE_TODOS.map((todo) => repository.create(todo)));
  return SAMPLE_TODOS.length;
};
