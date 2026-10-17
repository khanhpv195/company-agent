import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Member } from '../../workspace/entities/member.entity';

export type AccountTokenKind = 'reset_password' | 'verify_email';

/** Single-use emailed tokens. Only the sha256 of the token is stored. */
@Entity('account_tokens')
@Unique('UQ_account_tokens_token_hash', ['tokenHash'])
@Index('IDX_account_tokens_member_kind', ['memberId', 'kind'])
@Check('CHK_account_tokens_kind', `"kind" IN ('reset_password', 'verify_email')`)
export class AccountToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'member_id', type: 'uuid' })
  memberId: string;

  @ManyToOne(() => Member, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @Column({ type: 'varchar' })
  kind: AccountTokenKind;

  @Column({ name: 'token_hash', type: 'char', length: 64 })
  tokenHash: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
