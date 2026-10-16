import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TodoPriority } from '@repo/shared';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('todos')
export class Todo {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'Write the README' })
  @Column({ type: 'varchar', length: 255 })
  title: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @ApiProperty({ default: false })
  @Index()
  @Column({ type: 'boolean', default: false })
  completed: boolean;

  @ApiProperty({ enum: TodoPriority, default: TodoPriority.MEDIUM })
  @Column({
    type: 'enum',
    enum: TodoPriority,
    enumName: 'todo_priority',
    default: TodoPriority.MEDIUM,
  })
  priority: TodoPriority;

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
