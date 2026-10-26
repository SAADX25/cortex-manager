// Read-only statistics, independent of member migration and edit approval data.
export async function readMemberCounts(api,guildId){
  const [roles,guild]=await Promise.allSettled([
    api.get(`/guilds/${guildId}/roles/member-counts`),
    api.get(`/guilds/${guildId}?with_counts=true`),
  ]);
  const valid=n=>Number.isSafeInteger(n)&&n>=0;
  const map=roles.status==='fulfilled'&&roles.value&&typeof roles.value==='object'&&!Array.isArray(roles.value)?roles.value:null;
  return {total:guild.status==='fulfilled'&&valid(guild.value?.approximate_member_count)?guild.value.approximate_member_count:null,
    totalApproximate:true,roles:map?Object.fromEntries(Object.entries(map).filter(([id,n])=>/^\d{16,22}$/.test(id)&&id!==guildId&&valid(n))):null};
}
