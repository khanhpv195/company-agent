import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Member } from '../../workspace/entities/member.entity';
import { Skill } from './skill.entity';

/** One saved state of a skill; version 1 is written when the skill is created. */
@Entity('skill_versions')
@Unique('UQ_skill_versions_skill_version', ['skillId', 'version'])
export class SkillVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'skill_id', type: 'uuid' })
  skillId: string;

  @ManyToOne(() => Skill, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'skill_id' })
  skill: Skill;

  @Column({ type: 'int' })
  version: number;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 500 })
  description: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ name: 'edited_by_member_id', type: 'uuid', nullable: true })
  editedByMemberId: string | null;

  @ManyToOne(() => Member, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'edited_by_member_id' })
  editedBy: Member | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
