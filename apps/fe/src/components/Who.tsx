import { usePeople } from '../features/workspace/workspace.api';
import { AgentAvatar, MemberAvatar, NoAvatar } from './Avatar';

/** Avatar for an agent or member id (dashed circle when unassigned). */
export function Who({ id, size = 20 }: { id: string | null | undefined; size?: number }) {
  const people = usePeople();
  const agent = people.agent(id);
  if (agent) return <AgentAvatar agent={agent} size={size} />;
  const member = people.member(id);
  if (member) return <MemberAvatar member={member} size={size} />;
  return <NoAvatar size={size} />;
}
