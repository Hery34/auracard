
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "carnet": {
          Tables: {
            "links": {
                  Row: {
                    "created_at": string,"id": string,"label": string | null,"platform": string,"position": number,"profile_id": string,"updated_at": string,"url": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"label"?: string | null,"platform": string,"position": number,"profile_id": string,"updated_at"?: string,"url": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"label"?: string | null,"platform"?: string,"position"?: number,"profile_id"?: string,"updated_at"?: string,"url"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "links_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "avatar_url": string | null,"banner_url": string | null,"bio": string | null,"company": string | null,"contact_email": string | null,"created_at": string,"display_name": string,"id": string,"is_indexable": boolean,"is_published": boolean,"job_title": string | null,"owner_id": string,"phone": string | null,"slug": string,"theme": NonNullable<Json>,"updated_at": string,"website_url": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_url"?: string | null,"banner_url"?: string | null,"bio"?: string | null,"company"?: string | null,"contact_email"?: string | null,"created_at"?: string,"display_name": string,"id"?: string,"is_indexable"?: boolean,"is_published"?: boolean,"job_title"?: string | null,"owner_id": string,"phone"?: string | null,"slug": string,"theme"?: NonNullable<Json>,"updated_at"?: string,"website_url"?: string | null
                  }
                  Update: {
                    "avatar_url"?: string | null,"banner_url"?: string | null,"bio"?: string | null,"company"?: string | null,"contact_email"?: string | null,"created_at"?: string,"display_name"?: string,"id"?: string,"is_indexable"?: boolean,"is_published"?: boolean,"job_title"?: string | null,"owner_id"?: string,"phone"?: string | null,"slug"?: string,"theme"?: NonNullable<Json>,"updated_at"?: string,"website_url"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"rate_limits": {
                  Row: {
                    "count": number,"key": string,"window_start": string
                  }
                  ComputedFields: never
                  Insert: {
                    "count": number,"key": string,"window_start": string
                  }
                  Update: {
                    "count"?: number,"key"?: string,"window_start"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            "public_profiles": {
                  Row: {
                    "avatar_url": string | null,"banner_url": string | null,"bio": string | null,"company": string | null,"contact_email": string | null,"display_name": string | null,"is_indexable": boolean | null,"job_title": string | null,"phone": string | null,"slug": string | null,"theme": Json | null,"website_url": string | null
                  }
                  ComputedFields: never
                  Insert: {
                           "avatar_url"?: string | null,"banner_url"?: string | null,"bio"?: string | null,"company"?: string | null,"contact_email"?: string | null,"display_name"?: string | null,"is_indexable"?: boolean | null,"job_title"?: string | null,"phone"?: string | null,"slug"?: string | null,"theme"?: Json | null,"website_url"?: string | null
                         }
                        Update: {
                           "avatar_url"?: string | null,"banner_url"?: string | null,"bio"?: string | null,"company"?: string | null,"contact_email"?: string | null,"display_name"?: string | null,"is_indexable"?: boolean | null,"job_title"?: string | null,"phone"?: string | null,"slug"?: string | null,"theme"?: Json | null,"website_url"?: string | null
                         }
                        Relationships: [
                    
                  ]
                }
          }
          Functions: {
            "can_create_profile":
{ Args: { "p_owner_id": string }; Returns: boolean
                           },
"can_edit_profile":
{ Args: { "p_profile_id": string }; Returns: boolean
                           },
"can_read_profile_private":
{ Args: { "p_profile_id": string }; Returns: boolean
                           },
"consume_rate_limit":
{ Args: { "p_key": string,"p_limit": number,"p_window": string }; Returns: boolean
                           },
"get_public_links":
{ Args: { "p_slug": string }; Returns: {
              "label": string,"platform": string,"position": number,"url": string
            }[]
                           },
"get_public_profile":
{ Args: { "p_slug": string }; Returns: {
              "avatar_url": string | null,
"banner_url": string | null,
"bio": string | null,
"company": string | null,
"contact_email": string | null,
"display_name": string | null,
"is_indexable": boolean | null,
"job_title": string | null,
"phone": string | null,
"slug": string | null,
"theme": Json | null,
"website_url": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "public_profiles"
        isOneToOne: true
        isSetofReturn: true
      } },
"is_member":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"purge_rate_limits":
{ Args: { "p_older_than": string }; Returns: number
                           },
"register_member":
{ Args: { "p_display_name": string,"p_slug": string,"p_user_id": string }; Returns: string
                           },
"replace_links":
{ Args: { "p_links": Json,"p_profile_id": string }; Returns: {
              "created_at": string,
"id": string,
"label": string | null,
"platform": string,
"position": number,
"profile_id": string,
"updated_at": string,
"url": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "links"
        isOneToOne: false
        isSetofReturn: true
      } }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "carnet": {
          Enums: {
            
          }
        }
} as const
