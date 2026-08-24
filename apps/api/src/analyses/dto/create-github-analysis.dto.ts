import { IsOptional, IsString, IsUrl, MinLength } from 'class-validator';

export class CreateGithubAnalysisDto {
  @IsUrl({ require_protocol: true }, { message: 'githubUrl must be a valid URL' })
  githubUrl!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;
}
