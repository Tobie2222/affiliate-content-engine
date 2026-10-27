import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type ApprovalDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';

@Entity({ name: 'post_approvals' })
export class PostApproval {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'content_post_id', type: 'uuid' })
  contentPostId: string;

  @Column({ name: 'content_version', type: 'int' })
  contentVersion: number;

  @Column({ type: 'varchar', length: 20 })
  decision: ApprovalDecision;

  @Column({ name: 'reviewer_id', type: 'uuid', nullable: true })
  reviewerId: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
